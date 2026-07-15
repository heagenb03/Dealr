import React from 'react';
import { Modal, ScrollView, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, View } from '@/components/Themed';
import { HelpTopic } from '@/constants/helpTopics';
import HelpTopicRow from '@/components/HelpTopicRow';

interface Props {
  visible: boolean;
  title: string;
  topics: HelpTopic[];
  onClose: () => void;
  /** Parent must dismiss this sheet before navigating (iOS single-modal rule). */
  onSeeFullGuide: () => void;
}

export default function HelpSheet({ visible, title, topics, onClose, onSeeFullGuide }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Close help"
              >
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
              {topics.map((t) => (
                <HelpTopicRow key={t.id} topic={t} />
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.guideButton}
              onPress={onSeeFullGuide}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="See full guide"
            >
              <Text style={styles.guideText}>See full guide</Text>
              <Ionicons name="arrow-forward" size={16} color="#B072BB" />
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxHeight: '85%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // flexShrink lets the ScrollView yield height when the sheet clamps to its
  // maxHeight (expanded topics overflow), giving it a bounded frame so
  // contentSize > frame and it actually scrolls. Without it the ScrollView
  // sizes to full content height, contentSize == frame, and iOS treats it as
  // non-scrollable — lower content/the "See full guide" button become
  // unreachable. flexShrink (not flex:1) keeps basis auto so collapsed content
  // still sizes naturally and every topic row stays visible. Mirrors AppModal.
  scroll: { backgroundColor: 'transparent', flexShrink: 1 },
  guideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  guideText: { fontSize: 15, color: '#B072BB', fontWeight: '600' },
});
