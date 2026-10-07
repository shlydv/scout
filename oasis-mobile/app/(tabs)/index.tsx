import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import {
  LandingBestInClass,
  LandingDodgeList,
  LandingFacts,
  LandingGoalBoards,
  LandingStatsStrip,
} from "@/components/landing/LandingSections";
import { FadeInUp } from "@/components/motion/FadeInUp";
import { PressableScale } from "@/components/motion/PressableScale";
import { SkeletonGrid, SkeletonSection, SkeletonStats } from "@/components/motion/Skeleton";
import { ProductCard } from "@/components/ProductCard";
import { PromptChips } from "@/components/PromptChips";
import { ScoutSearchBar } from "@/components/ScoutSearchBar";
import { Screen } from "@/components/Screen";
import { SiteHeader } from "@/components/SiteHeader";
import { Panel } from "@/components/ui/Panel";
import { DisplayHero, Eyebrow } from "@/components/ui/Typography";
import { fetchCatalogMeta, fetchLanding } from "@/lib/api";
import { runCatalogSearch } from "@/lib/run-search";
import { useAccessToken } from "@/lib/auth";
import { useTheme } from "@/lib/theme-context";
import { fonts, radius, spacing } from "@/theme";
import { motion } from "@/theme/motion";
import type { AiSearchResult, CatalogMeta, CatalogProduct, LandingInsights } from "@/types/api";

const { width: SCREEN_W } = Dimensions.get("window");
const MARQUEE_CARD_W = 160;
const MARQUEE_GAP = 12;
const MARQUEE_DURATION = 55000; // ms for one full cycle

// ─── Marquee ─────────────────────────────────────────────────────────────────

function MarqueeShowcase({ products }: { products: Array<{ slug: string; name: string; brand?: string | null; image?: string | null; score?: number | null }> }) {
  const { colors } = useTheme();
  const router = useRouter();
  const translateX = useSharedValue(0);
  const paused = useSharedValue(false);

  // Duplicate for seamless loop
  const items = [...products, ...products];
  const totalWidth = products.length * (MARQUEE_CARD_W + MARQUEE_GAP);

  useEffect(() => {
    if (products.length === 0) return;
    translateX.value = withRepeat(
      withTiming(-totalWidth, { duration: MARQUEE_DURATION }),
      -1,
      false,
    );
  }, [products.length, totalWidth]);

  const marStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!products.length) return null;

  return (
    <View style={styles.marqueeOuter}>
      {/* Left fade */}
      <LinearGradient
        colors={[colors.bg, "transparent"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.marqueeFadeL, { pointerEvents: "none" } as ViewStyle]}
      />
      {/* Right fade */}
      <LinearGradient
        colors={["transparent", colors.bg]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.marqueeFadeR, { pointerEvents: "none" } as ViewStyle]}
      />

      <TouchableWithoutFeedback
        onPressIn={() => { cancelAnimation(translateX); }}
        onPressOut={() => {
          // Resume from current position
          const remaining = Math.abs(-totalWidth - translateX.value);
          const durationLeft = (remaining / totalWidth) * MARQUEE_DURATION;
          translateX.value = withRepeat(
            withTiming(-totalWidth, { duration: durationLeft }),
            -1,
            false,
          );
        }}
      >
        <Animated.View style={[styles.marqueeTrack, marStyle]}>
          {items.map((p, i) => (
            <Pressable
              key={`${p.slug}-${i}`}
              style={styles.marqueeCard}
              onPress={() => router.push(`/product/${p.slug}`)}
            >
              <View style={[styles.marqueeImageWrap, { backgroundColor: colors.bgSoft, borderColor: colors.line }]}>
                {p.image ? (
                  <Image source={{ uri: p.image }} style={styles.marqueeImage} contentFit="contain" />
                ) : null}
              </View>
              {p.brand ? (
                <Text style={[styles.marqueeBrand, { color: colors.fgDim }]} numberOfLines={1}>
                  {p.brand.toUpperCase()}
                </Text>
              ) : null}
              <Text style={[styles.marqueeName, { color: colors.fg }]} numberOfLines={2}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      </TouchableWithoutFeedback>
    </View>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

export default function HomeTab() {
  const router = useRouter();
  const token = useAccessToken();
  const { colors } = useTheme();

  const [landing, setLanding] = useState<LandingInsights | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta | null>(null);
  const [loadingLanding, setLoadingLanding] = useState(true);
  const [landingError, setLandingError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<AiSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const loadLanding = useCallback(async () => {
    setLandingError(null);
    try {
      const data = await fetchLanding();
      setLanding({
        ...data,
        goalBoards: data.goalBoards ?? [],
        bestInClass: data.bestInClass ?? [],
        dodgeList: data.dodgeList ?? [],
      });
    } catch (e) {
      setLanding(null);
      setLandingError(e instanceof Error ? e.message : "Could not load home feed.");
    }
  }, []);

  useEffect(() => {
    Promise.all([
      loadLanding(),
      fetchCatalogMeta().then(setCatalogMeta).catch(() => setCatalogMeta(null)),
    ]).finally(() => setLoadingLanding(false));
  }, [loadLanding]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLanding();
    setRefreshing(false);
  }, [loadLanding]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const data = await runCatalogSearch(trimmed, token, catalogMeta, 24);
      setSearchResult(data);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number; name?: string };
      if (err.name === "AbortError") {
        setSearchError("Search took too long — try again in a moment.");
      } else {
        setSearchError(err.message ?? "Search failed — try again.");
      }
    } finally {
      setSearching(false);
    }
  }, [token, catalogMeta?.filters.brands, catalogMeta?.filters.subcategories]);

  const clearSearch = useCallback(() => {
    setPrompt("");
    setSearchResult(null);
    setSearchError(null);
  }, []);

  const isSearchActive = searchResult !== null || searching || searchError !== null;

  // Marquee products: flatten bestInClass
  const marqueeProducts = (landing?.bestInClass ?? [])
    .flatMap((cat) => cat.products.map((p) => ({
      slug: p.slug,
      name: p.name,
      brand: p.brand,
      image: p.image,
      score: p.score,
    })))
    .slice(0, 12);

  // ── Search results view ──────────────────────────────────────────────────
  if (isSearchActive) {
    return (
      <Screen>
        <FadeInUp delay={0}>
          <View style={[styles.searchHeader, { borderBottomColor: colors.line }]}>
            <PressableScale onPress={clearSearch} haptic="light">
              <View style={[styles.backBtn, { backgroundColor: colors.panel, borderColor: colors.line }]}>
                <Ionicons name="arrow-back" size={20} color={colors.fg} />
              </View>
            </PressableScale>
            <View style={styles.searchBarWrap}>
              <ScoutSearchBar
                value={prompt}
                onChangeText={setPrompt}
                onSubmit={() => void runSearch(prompt)}
                loading={searching}
              />
            </View>
          </View>
        </FadeInUp>

        {searching ? (
          <View style={styles.searchLoadingWrap}>
            <SkeletonGrid rows={2} />
            <Text style={[styles.searchWaitHint, { color: colors.fgMuted }]}>
              Scout is ranking matches — this can take up to a minute on first search.
            </Text>
          </View>
        ) : searchError ? (
          <FadeInUp>
            <Panel style={styles.errorBox}>
              <Text style={[styles.errorText, { color: colors.bad }]}>{searchError}</Text>
            </Panel>
          </FadeInUp>
        ) : searchResult ? (
          <FlatList
            data={searchResult.items}
            keyExtractor={(p: CatalogProduct) => p.id}
            numColumns={2}
            contentContainerStyle={styles.resultsGrid}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <FadeInUp delay={0}>
                <Panel style={styles.summaryPanel}>
                  <Text style={[styles.summaryText, { color: colors.fg }]}>{searchResult.summary}</Text>
                  {searchResult.parse_warning ? (
                    <Text style={[styles.parseWarning, { color: colors.fgMuted }]}>
                      {searchResult.parse_warning}
                    </Text>
                  ) : null}
                  {searchResult.refinements?.length ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: spacing.sm }}
                      contentContainerStyle={{ gap: spacing.xs }}
                    >
                      {searchResult.refinements.map((r) => (
                        <PressableScale
                          key={r}
                          haptic="light"
                          onPress={() => {
                            const next = `${prompt.trim()} ${r.replace(/^Add /i, "")}`.trim();
                            setPrompt(next);
                            void runSearch(next);
                          }}
                        >
                          <View style={[styles.refineChip, { borderColor: colors.line, backgroundColor: colors.bgSoft }]}>
                            <Text style={[styles.refineText, { color: colors.fg }]}>{r}</Text>
                          </View>
                        </PressableScale>
                      ))}
                    </ScrollView>
                  ) : null}
                </Panel>
              </FadeInUp>
            }
            renderItem={({ item, index }) => (
              <FadeInUp delay={Math.min(index, 8) * motion.stagger}>
                <ProductCard product={item} aiReasons={item.ai_match_reasons} />
              </FadeInUp>
            )}
            ListEmptyComponent={
              <FadeInUp>
                <Text style={[styles.emptyText, { color: colors.fgDim }]}>
                  No products matched. Try rephrasing your search.
                </Text>
              </FadeInUp>
            }
          />
        ) : null}
      </Screen>
    );
  }

  // ── Landing view ─────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <FadeInUp delay={0}>
          <SiteHeader />
        </FadeInUp>

        {/* Editorial hero */}
        <FadeInUp delay={motion.stagger}>
          <View style={styles.heroWrap}>
            <Eyebrow style={{ paddingHorizontal: spacing.lg }}>Ask Scout</Eyebrow>
            <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
              <DisplayHero
                text="We read the back label"
                accent="so you don't have to"
              />
            </View>
          </View>
        </FadeInUp>

        {/* Search */}
        <FadeInUp delay={motion.stagger * 2}>
          <View style={styles.searchBlock}>
            <ScoutSearchBar value={prompt} onChangeText={setPrompt} onSubmit={() => void runSearch(prompt)} />
          </View>
        </FadeInUp>

        <FadeInUp delay={motion.stagger * 3}>
          <PromptChips
            style={styles.chipsBlock}
            onSelect={(p) => {
              setPrompt(p);
              void runSearch(p);
            }}
          />
        </FadeInUp>

        {/* Marquee showcase */}
        {marqueeProducts.length > 0 && (
          <FadeInUp delay={motion.stagger * 4}>
            <MarqueeShowcase products={marqueeProducts} />
          </FadeInUp>
        )}

        {/* Landing sections */}
        {loadingLanding && !landing ? (
          <View>
            <SkeletonStats />
            <SkeletonSection />
            <SkeletonSection />
          </View>
        ) : landingError ? (
          <FadeInUp>
            <Panel style={styles.errorBox}>
              <Text style={[styles.errorText, { color: colors.bad }]}>{landingError}</Text>
              <PressableScale onPress={() => void loadLanding()} haptic="light">
                <View style={[styles.upgradeBtn, { backgroundColor: colors.fg }]}>
                  <Text style={[styles.upgradeBtnText, { color: colors.bg }]}>Retry</Text>
                </View>
              </PressableScale>
            </Panel>
          </FadeInUp>
        ) : landing ? (
          <>
            <FadeInUp delay={0}>
              <LandingStatsStrip totalScored={landing.totalScored} avgScore={landing.avgScore} />
            </FadeInUp>
            {landing.facts?.length > 0 && (
              <FadeInUp delay={motion.stagger}>
                <LandingFacts facts={landing.facts} />
              </FadeInUp>
            )}
            {landing.goalBoards?.length > 0 && (
              <FadeInUp delay={motion.stagger * 2}>
                <LandingGoalBoards boards={landing.goalBoards} />
              </FadeInUp>
            )}
            {landing.bestInClass?.length > 0 && (
              <FadeInUp delay={motion.stagger * 3}>
                <LandingBestInClass categories={landing.bestInClass} />
              </FadeInUp>
            )}
            {landing.dodgeList?.length > 0 && (
              <FadeInUp delay={motion.stagger * 4}>
                <LandingDodgeList items={landing.dodgeList} />
              </FadeInUp>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl * 2 },
  heroWrap: { marginTop: spacing.sm, marginBottom: spacing.lg },
  searchBlock: { paddingHorizontal: spacing.lg },
  chipsBlock: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },

  // Marquee
  marqueeOuter: {
    marginTop: spacing.xl,
    overflow: "hidden",
    height: 220,
  },
  marqueeTrack: {
    flexDirection: "row",
    gap: MARQUEE_GAP,
    paddingHorizontal: spacing.lg,
  },
  marqueeCard: { width: MARQUEE_CARD_W },
  marqueeImageWrap: {
    width: MARQUEE_CARD_W,
    height: MARQUEE_CARD_W,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  marqueeImage: { width: "100%", height: "100%", padding: 8 },
  marqueeBrand: { fontFamily: fonts.sansMedium, fontSize: 9, letterSpacing: 1.2, marginTop: 8 },
  marqueeName: { fontFamily: fonts.sansSemiBold, fontSize: 12, lineHeight: 16, marginTop: 3 },
  marqueeFadeL: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 32,
    zIndex: 10,
  },
  marqueeFadeR: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 32,
    zIndex: 10,
  },

  // Search results
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBarWrap: { flex: 1 },
  searchLoadingWrap: { flex: 1, paddingHorizontal: spacing.lg },
  searchWaitHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.md,
  },
  errorBox: { margin: spacing.lg },
  errorText: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  upgradeBtn: {
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  upgradeBtnText: { fontFamily: fonts.sansBold, fontSize: 15 },
  resultsGrid: { padding: spacing.sm, paddingBottom: spacing.xxl },
  summaryPanel: { margin: spacing.sm, marginBottom: 0 },
  summaryText: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  parseWarning: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  refineChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  refineText: { fontFamily: fonts.sansMedium, fontSize: 12 },
  emptyText: {
    fontFamily: fonts.sans,
    textAlign: "center",
    padding: spacing.xl,
    fontSize: 15,
    lineHeight: 22,
  },
});
