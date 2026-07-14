import { StyleSheet } from 'react-native';
import { Text, View } from '@/components/Themed';

export default function HistoryMonthHeader({ label }: { label: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.hairline} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(176,114,187,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  hairline: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.15)',
  },
});
