import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from '@/components/Themed';
import { HelpTopic } from '@/constants/helpTopics';
import SwipeHelpVisual from '@/components/SwipeHelpVisual';

interface Props {
  topic: HelpTopic;
}

/** One tap-to-expand help topic. Used by the Guide and every HelpSheet. */
export default function HelpTopicRow({ topic }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={topic.title}
        accessibilityState={{ expanded }}
      >
        <View style={styles.headerLeft}>
          <Ionicons name={topic.icon as any} size={20} color="#B072BB" />
          <Text style={styles.title}>{topic.title}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#666"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {topic.paragraphs.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))}
          {topic.visual === 'swipe' && <SwipeHelpVisual />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', flex: 1 },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: 'transparent',
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: '#FFFFFF',
    opacity: 0.85,
    marginBottom: 10,
  },
});
