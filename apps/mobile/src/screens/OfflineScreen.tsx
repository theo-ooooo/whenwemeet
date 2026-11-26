// 오프라인/오류 화면 (docs/설계/앱.md 4.4). 웹뷰 대신 네이티브로 그린다
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";

type Props = { offline: boolean; onRetry: () => void };

export function OfflineScreen({ offline, onRetry }: Props) {
  const t = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>{offline ? "인터넷에 연결되어 있지 않아요" : "화면을 불러오지 못했어요"}</Text>
      <Text style={[styles.sub, { color: t.sub }]}>{offline ? "연결을 확인한 뒤 다시 시도해 주세요" : "잠시 후 다시 시도해 주세요"}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.btn, { backgroundColor: t.brand }, pressed && { opacity: 0.7 }]}>
        <Text style={styles.btnText}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center", marginBottom: 16 },
  btn: { paddingHorizontal: 28, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
