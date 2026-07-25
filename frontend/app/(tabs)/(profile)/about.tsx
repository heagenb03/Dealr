import { StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Text, View } from '@/components/Themed';
import HudSectionHeader from '@/components/HudSectionHeader';
import { PRIVACY_POLICY_URL, TERMS_URL, SUPPORT_EMAIL } from '@/constants/Links';

export default function AboutScreen() {
  const handleEmailPress = () => {
    const mailto = `mailto:${SUPPORT_EMAIL}`;
    Linking.openURL(mailto).catch(err => {
      console.error('Failed to open email client:', err);
    });
  };

  const handlePrivacyPress = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(err => {
      console.error('Failed to open privacy policy:', err);
    });
  };

  const handleTermsPress = () => {
    Linking.openURL(TERMS_URL).catch(err => {
      console.error('Failed to open terms of service:', err);
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Overview Section */}
        <View style={styles.section}>
          <HudSectionHeader label="Overview" centered={true} />

          <View style={styles.contentCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Team</Text>
              <Text style={styles.infoValue}>Heagen Bell</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Started</Text>
              <Text style={styles.infoValue}>February 2026</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Contact</Text>
              <Text style={styles.infoValueLink} onPress={handleEmailPress}>
                cashcageapp@gmail.com
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Privacy Policy</Text>
              <Text style={styles.infoValueLink} onPress={handlePrivacyPress}>
                View
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Terms of Service</Text>
              <Text style={styles.infoValueLink} onPress={handleTermsPress}>
                View
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Platforms</Text>
              <View style={styles.platformIcons}>
                <Ionicons name="logo-apple" size={20} color="#FFFFFF" style={styles.platformIcon} />
              </View>
            </View>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <HudSectionHeader label="About" centered={true} />

          <View style={styles.contentCard}>
            <Text style={styles.bodyText}>
              Cash Cage is a poker buy-in and cash-out tracking app designed to simplify managing home cash games.
              Built for the hosts who are in charge of settling the games, Cash Cage is designed to be simple but
              powerful.
            </Text>
            <Text style={styles.bodyText}>
              During the game, you can quickly add buy-ins and cash-outs for each player.
              Once the game is over, you can settle the game, and Cash Cage will calculate who owes who with X amount.
            </Text>
            <Text style={styles.bodyText}>
              This is a student-built app by Heagen Bell, a computer science student at the University of Kansas and commonly the host for home games,
              who wanted a better way to manage his games at college. Please reach out with any questions, feedback, or if you want to get involved 
              as the project is open-source. 
            </Text>
          </View>
        </View>

        {/* App Info Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Cash Cage v{Constants.expoConfig?.version ?? '-'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 32,
    backgroundColor: 'transparent',
  },
  contentCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  infoLabel: {
    fontSize: 15,
    color: '#FFFFFF',
    opacity: 0.5,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  infoValueLink: {
    fontSize: 15,
    color: '#B072BB',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  platformIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  platformIcon: {
    marginLeft: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(176,114,187,0.1)',
    marginVertical: 12,
  },
  bodyText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 24,
    opacity: 0.85,
    marginBottom: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 28,
    backgroundColor: 'transparent',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#B072BB',
    marginTop: 4,
    marginRight: 16,
    borderWidth: 2,
    borderColor: 'rgba(176,114,187,0.3)',
  },
  timelineContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  timelineDate: {
    fontSize: 12,
    color: '#B072BB',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  timelineTitle: {
    fontSize: 17,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 6,
  },
  timelineDescription: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.7,
    lineHeight: 22,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: 'transparent',
  },
  footerText: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.4,
    fontWeight: '600',
    marginBottom: 4,
  },
  footerTextSecondary: {
    fontSize: 12,
    color: '#B072BB',
    opacity: 0.6,
    fontWeight: '500',
  },
});
