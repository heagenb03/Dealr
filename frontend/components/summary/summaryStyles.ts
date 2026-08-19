/**
 * Styles for the summary screen's card components.
 *
 * One StyleSheet rather than one per component: `recipientName`, `payeeBadge`,
 * `payeeBadgeTap`, `payButton` and `payButtonText` are shared by SettlementCard
 * and BankerPayoutRow, and duplicating them into per-component sheets is exactly
 * the drift this extraction exists to prevent.
 *
 * These keys moved verbatim out of app/(tabs)/(home)/game/summary.tsx. The screen
 * keeps its own `styles` for the chrome it still owns (container, header, hero
 * pot, actions row, fallback banner, reopen modal).
 */
import { StyleSheet } from 'react-native';

export const summaryStyles = StyleSheet.create({
  // padding moved to listContent: RN documents contentContainerStyle as the place for a
  // list's inner padding; padding on a FlatList's `style` insets the scroll frame itself.
  scrollView: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    // 20 (the ScrollView's old bottom padding) + 32 (the balances section's old
    // marginBottom, destroyed by flattening).
    paddingBottom: 52,
  },
  // Re-creates the settlements section's marginBottom: 32, which used to sit between the
  // last settlement card and the FINAL BALANCES header.
  listSectionHeader: {
    marginTop: 32,
    backgroundColor: 'transparent',
  },
  // Re-creates the `gap: 8` the balances container used to apply. Applied to every
  // balance row but the last, so there is no trailing gap — matching gap semantics exactly.
  balanceGap: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  hudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
    backgroundColor: 'transparent',
  },
  hudLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  hudLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#B072BB',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    backgroundColor: 'transparent',
  },
  emptyIconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  emptyStateText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5,
  },
  settlementCard: {
    backgroundColor: '#161616',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#242424',
    borderTopColor: 'rgba(176,114,187,0.15)',
  },
  settlementCardBody: {
    backgroundColor: 'transparent',
  },
  settlementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  recipientName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  totalSection: {
    backgroundColor: 'transparent',
  },
  totalLabel: {
    fontSize: 9,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  totalAmount: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'SpaceMono',
  },
  paymentDetailsSection: {
    backgroundColor: 'transparent',
    marginTop: 12,
  },
  paymentDivider: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginBottom: 8,
  },
  paymentSectionLabel: {
    fontSize: 9,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  // Rows are built in JS (buildPaymentGridRows) and each is its own flex row, so
  // nothing wraps. Do NOT reintroduce flexWrap here: the previous single wrapping
  // row gave its cells a percentage width that left no room for the dividers
  // between them, which overflowed the container and wrapped a cell away.
  paymentGrid: {
    flexDirection: 'column',
    backgroundColor: 'transparent',
    rowGap: 14,
  },
  paymentGridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  // flex:1 over a fixed percentage: cells split whatever the dividers leave behind,
  // so the row fits at any screen width instead of overflowing by a fixed amount.
  paymentGridCell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
  },
  paymentGridDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 8,
    alignSelf: 'center',
  },
  // Same footprint as the divider, no rule. Holds the column geometry of a
  // partially filled last row so its cells line up with the rows above.
  paymentGridDividerSpacer: {
    width: 1,
    marginHorizontal: 8,
    backgroundColor: 'transparent',
  },
  // lineHeight + minHeight reserve the full two lines numberOfLines={2} allows, so a
  // one-line name and a wrapped one push the amount below them to the same baseline.
  paymentNameLabel: {
    fontSize: 9,
    lineHeight: 12,
    minHeight: 24,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  paymentAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    // Guaranteed minimum gap above payButton, whose own marginTop is 'auto'.
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  paymentAmountValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'SpaceMono',
  },
  // Player Card styles (read-only version)
  playerCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#242424',
    borderTopColor: 'rgba(176,114,187,0.15)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  playerName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  balanceHint: {
    marginLeft: 6,
    fontSize: 10,
    fontStyle: 'italic',
    color: 'rgba(255,255,255,0.35)',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dataItem: {
    flex: 1,
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  dataLabel: {
    fontSize: 9,
    color: 'rgba(176,114,187,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  dataValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'SpaceMono',
  },
  dataDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 12,
  },
  recipientNameWrapper: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  payeeBadge: {
    fontSize: 12,
    fontFamily: 'SpaceMono',
    color: 'rgba(176,114,187,0.9)',
    marginTop: 2,
    letterSpacing: 0.2,
  },
  toggleA11yRegion: {
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  payeeBadgeTap: {
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  // marginTop:'auto' pins the button to the bottom of the (stretched) cell, so the
  // buttons in a row stay on one line even where font scaling defeats the name slot's
  // fixed minHeight. The gap above it is paymentAmountRow's marginBottom, because an
  // auto margin cannot also carry a minimum.
  payButton: {
    marginTop: 'auto',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(176,114,187,0.35)',
    alignSelf: 'stretch',
  },
  payButtonText: {
    fontSize: 11,
    color: '#B072BB',
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161616',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#242424',
    borderTopColor: 'rgba(176,114,187,0.15)',
    gap: 12,
  },
  payoutInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  payoutRight: {
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
    gap: 6,
  },
  payoutAmount: {
    fontSize: 15,
    color: '#FFFFFF',
    fontFamily: 'SpaceMono',
    fontWeight: '600',
  },
});
