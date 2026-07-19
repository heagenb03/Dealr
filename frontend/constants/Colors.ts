const purpPrimary = '#B072BB';
const purpAccent = '#49264F';
const darkBg = '#0A0A0A';
const cardBg = '#1A1A1A';

const tintColorLight = purpPrimary;
const tintColorDark = purpPrimary;

export default {
  light: {
    text: '#000',
    background: '#fff',
    tint: tintColorLight,
    tabIconDefault: '#999',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#FFFFFF',
    background: darkBg,
    tint: tintColorDark,
    tabIconDefault: '#666',
    tabIconSelected: purpPrimary,
    card: cardBg,
    border: '#2A2A2A',
    purp: purpPrimary,
    purpAccent: purpAccent,
    success: '#00D66F',
    danger: '#FF3B5C',
    warning: '#D4AF37',
  },
};
