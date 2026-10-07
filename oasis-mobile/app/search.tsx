import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ProductCard } from "@/components/ProductCard";
import { ScoutSearchBar } from "@/components/ScoutSearchBar";
import { Screen } from "@/components/Screen";
import { Panel } from "@/components/ui/Panel";
import { fetchCatalogMeta } from "@/lib/api";
import { runCatalogSearch } from "@/lib/run-search";
import { useAccessToken } from "@/lib/auth";
import { saveSearch } from "@/lib/saved-searches";
import { colors, fonts, radius, spacing, typography } from "@/theme";
import type { AiSearchResult, CatalogMeta, CatalogProduct } from "@/types/api";

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const token = useAccessToken();
  const [prompt, setPrompt] = useState(params.q ?? "");
  const [result, setResult] = useState<AiSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    fetchCatalogMeta().then(setCatalogMeta).catch(() => setCatalogMeta(null));
  }, []);

  const run = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) return;
      setLoading(true);
      setError(null);
      try {
        const data = await runCatalogSearch(trimmed, token, catalogMeta, 24);
        setResult(data);
        setPrompt(trimmed);
      } catch (e) {
        const err = e as Error & { code?: string; status?: number; name?: string };
        if (err.name === "AbortError") {
          setError("Search took too long — try again in a moment.");
        } else {
          setError(err.message);
        }
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [token, catalogMeta?.filters.brands, catalogMeta?.filters.subcategories],
  );

  useEffect(() => {
    if (params.q && params.q.length >= 2) void run(params.q);
  }, [params.q, run]);

  const ListHeader = (
    <>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Ask Scout</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.searchWrap}>
        <ScoutSearchBar
          value={prompt}
          onChangeText={setPrompt}
          onSubmit={() => void run(prompt)}
          loading={loading}
        />
      </View>

      {loading && !result ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Scout is reading labels and ranking matches…</Text>
        </View>
      ) : null}

      {error ? (
        <Panel style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </Panel>
      ) : null}

      {result ? (
        <Panel style={styles.summaryPanel}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summary, { flex: 1 }]}>{result.summary}</Text>
            {token ? (
              <View style={styles.saveRow}>
                <Pressable
                  style={styles.saveBtn}
                  disabled={saveBusy || !prompt.trim()}
                  onPress={() => {
                    const q = prompt.trim();
                    if (!q) return;
                    setSaveBusy(true);
                    setSaveStatus(null);
                    void saveSearch(token, { query: q, alert_enabled: false })
                      .then(() => setSaveStatus("Saved"))
                      .catch((e: Error) => setSaveStatus(e.message))
                      .finally(() => setSaveBusy(false));
                  }}
                >
                  <Ionicons name="bookmark-outline" size={16} color={colors.fgMuted} />
                  <Text style={styles.saveBtnText}>{saveBusy ? "…" : "Save"}</Text>
                </Pressable>
                <Pressable
                  style={styles.saveBtn}
                  disabled={saveBusy || !prompt.trim()}
                  onPress={() => {
                    const q = prompt.trim();
                    if (!q) return;
                    setSaveBusy(true);
                    setSaveStatus(null);
                    void saveSearch(token, { query: q, alert_enabled: true })
                      .then(() => setSaveStatus("Saved with alerts"))
                      .catch((e: Error) => setSaveStatus(e.message))
                      .finally(() => setSaveBusy(false));
                  }}
                >
                  <Ionicons name="notifications-outline" size={16} color={colors.fgMuted} />
                  <Text style={styles.saveBtnText}>Alert</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          {saveStatus ? <Text style={styles.saveStatus}>{saveStatus}</Text> : null}
          {result.parse_warning ? (
            <Text style={styles.parseWarning}>{result.parse_warning}</Text>
          ) : null}
          {result.parse_source ? (
            <Text style={styles.meta}>
              {result.intent_tier ?? "semantic"} · parse {result.parse_source} · rank {result.rank_source}
            </Text>
          ) : null}
          {result.relaxed ? (
            result.relaxation_explanations?.length ? (
              result.relaxation_explanations.map((step) => (
                <Text key={step} style={styles.relaxed}>
                  {step}
                </Text>
              ))
            ) : (
              <Text style={styles.relaxed}>Showing closest matches — criteria relaxed slightly.</Text>
            )
          ) : null}
          {result.refinements?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.refineRow}>
              {result.refinements.map((r) => (
                <Pressable key={r} style={styles.refineChip} onPress={() => void run(`${prompt.trim()} ${r.replace(/^Add /i, "")}`.trim())}>
                  <Text style={styles.refineText}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </Panel>
      ) : null}
    </>
  );

  const flatItems = result?.items ?? [];

  return (
    <Screen>
      {result ? (
        <FlatList
          data={flatItems}
          keyExtractor={(p: CatalogProduct, index) => `${p.id}-${index}`}
          numColumns={2}
          ListHeaderComponent={
            <>
              {ListHeader}
            </>
          }
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <ProductCard product={item} aiReasons={item.ai_match_reasons} />
          )}
        />
      ) : (
        <View style={{ flex: 1 }}>{ListHeader}</View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  headerTitle: { ...typography.title, fontSize: 18, color: colors.fg },
  searchWrap: { paddingHorizontal: spacing.lg },
  center: { padding: spacing.xl, alignItems: "center" },
  loadingText: {
    fontFamily: fonts.sans,
    color: colors.fgMuted,
    marginTop: spacing.md,
    textAlign: "center",
    fontSize: 14,
  },
  errorBox: { margin: spacing.lg },
  errorText: { fontFamily: fonts.sans, color: colors.bad, fontSize: 15 },
  upgradeBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.fg,
    padding: 12,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  upgradeBtnText: { fontFamily: fonts.sansBold, color: colors.bg },
  summaryPanel: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  saveRow: { flexDirection: "row", gap: 6 },
  summary: { fontFamily: fonts.sans, color: colors.fg, fontSize: 15, lineHeight: 22 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  saveBtnText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.fgMuted },
  saveStatus: { fontFamily: fonts.sans, fontSize: 12, color: colors.fgDim, marginTop: 4 },
  parseWarning: {
    fontFamily: fonts.sans,
    color: colors.fgMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  meta: {
    fontFamily: fonts.sans,
    color: colors.fgDim,
    fontSize: 11,
    marginTop: 6,
  },
  relaxed: { fontFamily: fonts.sans, color: colors.fgDim, fontSize: 12, marginTop: spacing.sm },
  refineRow: { marginTop: spacing.md, maxHeight: 40 },
  refineChip: {
    marginRight: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
  },
  refineText: { fontFamily: fonts.sansMedium, color: colors.fg, fontSize: 13 },
  grid: { padding: spacing.sm, paddingBottom: spacing.xl },
});
