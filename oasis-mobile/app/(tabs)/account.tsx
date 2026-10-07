import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { SiteHeader } from "@/components/SiteHeader";
import { Panel } from "@/components/ui/Panel";
import { Eyebrow, SectionTitle } from "@/components/ui/Typography";
import { useAccessToken, useAuth } from "@/lib/auth";
import {
  deleteSavedSearch,
  listSavedSearches,
  runSearchAlerts,
  updateSavedSearch,
} from "@/lib/saved-searches";
import { colors, fonts, radius, spacing } from "@/theme";
import type { SavedSearchRow } from "@/types/api";

export default function AccountTab() {
  const router = useRouter();
  const { profile, signOut, refreshProfile } = useAuth();
  const accessToken = useAccessToken();
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [alertHits, setAlertHits] = useState<
    Array<{ id: string; query: string; new_matches: number }>
  >([]);

  const loadSaved = useCallback(async () => {
    const rows = await listSavedSearches(accessToken);
    setSavedSearches(rows);
  }, [accessToken]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    if (!accessToken) return;
    void runSearchAlerts(accessToken).then((r) => setAlertHits(r.triggered));
  }, [accessToken]);

  async function handleToggleAlert(row: SavedSearchRow) {
    setDeletingId(row.id);
    try {
      await updateSavedSearch(accessToken, { id: row.id, alert_enabled: !row.alert_enabled });
      await loadSaved();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteSaved(id: string) {
    setDeletingId(id);
    try {
      await deleteSavedSearch(accessToken, id);
      await loadSaved();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SiteHeader />
        <Eyebrow style={styles.eyebrow}>Your account</Eyebrow>
        <SectionTitle style={styles.title}>Settings</SectionTitle>

        <Panel style={styles.card}>
          <Text style={styles.label}>Scout</Text>
          <Text style={styles.value}>Free for everyone</Text>
          <Text style={styles.hint}>Unlimited search</Text>
        </Panel>

        {profile?.email ? (
          <Panel style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{profile.email}</Text>
          </Panel>
        ) : null}
        {profile?.phone ? (
          <Panel style={styles.card}>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{profile.phone}</Text>
          </Panel>
        ) : null}


        {alertHits.length > 0 ? (
          <Panel style={styles.card}>
            <Text style={styles.label}>Search alerts</Text>
            {alertHits.slice(0, 3).map((hit) => (
              <Text key={hit.id} style={styles.alertHit}>
                {hit.new_matches} new match{hit.new_matches === 1 ? "" : "es"} for “{hit.query}”
              </Text>
            ))}
          </Panel>
        ) : null}

        {savedSearches.length > 0 ? (
          <Panel style={styles.card}>
            <Text style={styles.label}>Saved searches</Text>
            {savedSearches.slice(0, 5).map((s) => (
              <View key={s.id} style={styles.savedRow}>
                <Pressable
                  style={styles.savedMain}
                  onPress={() => router.push({ pathname: "/search", params: { q: s.query } })}
                >
                  <Text style={styles.savedQuery} numberOfLines={1}>
                    {s.label || s.query}
                  </Text>
                  {s.alert_enabled ? (
                    <Text style={styles.savedAlert}>Alerts on</Text>
                  ) : null}
                </Pressable>
                <Pressable
                  hitSlop={8}
                  disabled={deletingId === s.id}
                  onPress={() => void handleToggleAlert(s)}
                >
                  <Ionicons
                    name={s.alert_enabled ? "notifications" : "notifications-outline"}
                    size={18}
                    color={s.alert_enabled ? colors.accent : colors.fgMuted}
                  />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  disabled={deletingId === s.id}
                  onPress={() => void handleDeleteSaved(s.id)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={deletingId === s.id ? colors.fgDim : colors.fgMuted}
                  />
                </Pressable>
              </View>
            ))}
          </Panel>
        ) : null}

        <Pressable style={styles.row} onPress={() => void refreshProfile()}>
          <Text style={styles.rowText}>Refresh status</Text>
          <Ionicons name="refresh" size={18} color={colors.fgMuted} />
        </Pressable>

        <Pressable style={styles.row} onPress={() => void signOut()}>
          <Text style={[styles.rowText, { color: colors.bad }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  eyebrow: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  title: { fontSize: 26, paddingHorizontal: spacing.lg, marginTop: 4, marginBottom: spacing.md },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  label: { fontFamily: fonts.sansMedium, fontSize: 10, letterSpacing: 1, color: colors.fgDim, textTransform: "uppercase" },
  value: { fontFamily: fonts.sansSemiBold, fontSize: 18, color: colors.fg, marginTop: 4 },
  hint: { fontFamily: fonts.sans, color: colors.fgMuted, fontSize: 13, marginTop: 6 },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.fg,
    borderRadius: radius.xl,
    paddingVertical: 16,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  primaryText: { fontFamily: fonts.sansBold, color: colors.bg, fontSize: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    marginHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowText: { fontFamily: fonts.sans, color: colors.fg, fontSize: 16 },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  savedMain: { flex: 1 },
  alertHit: { fontFamily: fonts.sans, fontSize: 13, color: colors.fg, marginTop: spacing.sm },
  savedQuery: { fontFamily: fonts.sansMedium, fontSize: 15, color: colors.fg },
  savedAlert: { fontFamily: fonts.sans, fontSize: 12, color: colors.fgMuted, marginTop: 2 },
});
