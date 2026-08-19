/**
 * The game summary's list, and nothing else.
 *
 * Purely presentational: it takes the already-built SummaryListItem[] and the
 * formatters to render it with, and owns no game logic, no solver, no fetch and
 * no navigation. The host screen (app/(tabs)/(home)/game/summary.tsx) keeps all
 * of that and supplies the header slot; the shared-game route will render the
 * same component from a frozen snapshot.
 *
 * Both formatters are props rather than a useCurrency() read: a shared snapshot
 * is formatted in the GAME's currency, which need not be the viewer's.
 *
 * The pinned actions row (Reopen / Done) is deliberately NOT a footer slot — it
 * is a sibling of this list in the host screen, outside the scroll area.
 */
import React, { useCallback } from 'react';
import { FlatList, ListRenderItemInfo } from 'react-native';
import { View } from '@/components/Themed';
import { PreferredPayment } from '@/types/game';
import { SummaryListItem } from '@/utils/summaryListData';
import BalanceCard from './BalanceCard';
import BankerPayoutRow from './BankerPayoutRow';
import SettlementCard from './SettlementCard';
import SummaryEmptyState from './SummaryEmptyState';
import SummaryHudHeader from './SummaryHudHeader';
import { summaryStyles as styles } from './summaryStyles';

export interface SummaryItemDeps {
  /** Full currency format, e.g. "$1,234.56". Settlement and payout amounts. */
  formatAmount: (value: number) => string;
  /** Compact (k/M) currency format. Balance card IN / OUT / NET only. */
  formatAmountCompact: (value: number) => string;
  paymentByName: Map<string, PreferredPayment>;
  reduceMotion: boolean;
}

export interface SummaryViewProps extends SummaryItemDeps {
  data: SummaryListItem[];
  ListHeaderComponent?: React.ReactElement | null;
}

/**
 * The FlatList row switch, lifted out as a pure function.
 *
 * It is exported for one concrete reason: a FlatList cannot be rendered under
 * jest-expo/node without hanging the suite SYNCHRONOUSLY (measured — a ScrollView
 * renders in 29ms, a 3-row FlatList never returns and survives jest's 5s
 * testTimeout). Routing every SummaryListItem variant to the right component is
 * the only logic this module owns, and this is how it stays testable.
 *
 * No hooks here — it is called from inside a useCallback, not rendered as a
 * component.
 */
export function renderSummaryItem(
  item: SummaryListItem,
  { formatAmount, formatAmountCompact, paymentByName, reduceMotion }: SummaryItemDeps,
) {
  switch (item.type) {
    case 'empty':
      return <SummaryEmptyState label={item.label} icon={item.icon} />;
    case 'bankerPayout':
      return (
        <BankerPayoutRow
          recipient={item.recipient}
          amount={item.amount}
          recipientPayment={paymentByName.get(item.recipient)}
          formatAmount={formatAmount}
        />
      );
    case 'settlement':
      return (
        <SettlementCard
          groupedSettlement={item.grouped}
          recipientPayment={paymentByName.get(item.grouped.recipient)}
          reduceMotion={reduceMotion}
          formatAmount={formatAmount}
        />
      );
    case 'sectionHeader':
      return (
        <View style={styles.listSectionHeader}>
          <SummaryHudHeader label={item.label} />
        </View>
      );
    case 'balance':
      return (
        <View style={item.isLast ? undefined : styles.balanceGap}>
          <BalanceCard
            balance={item.balance}
            reduceMotion={reduceMotion}
            hint={item.hint}
            formatAmountCompact={formatAmountCompact}
          />
        </View>
      );
  }
}

export default function SummaryView({
  data,
  formatAmount,
  formatAmountCompact,
  paymentByName,
  reduceMotion,
  ListHeaderComponent,
}: SummaryViewProps) {
  const keyExtractor = useCallback((item: SummaryListItem) => item.key, []);

  // Every formatter this closes over MUST be in the dep array. Miss one and a
  // currency change re-renders this component while the rows keep formatting in
  // the old currency — silently, with no error.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SummaryListItem>) =>
      renderSummaryItem(item, { formatAmount, formatAmountCompact, paymentByName, reduceMotion }),
    [paymentByName, reduceMotion, formatAmount, formatAmountCompact],
  );

  return (
    <FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeaderComponent}
      style={styles.scrollView}
      contentContainerStyle={styles.listContent}
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      /* RN's default 21, not the 5 the other converted surfaces use: SettlementCard
         owns `isExpanded` local state that a user expects to persist. At windowSize=5
         a card scrolled ~2 viewports away unmounts and comes back COLLAPSED, which is
         reachable around a 12-20 player game. Under the pre-virtualization ScrollView
         expansion survived any amount of scrolling; this keeps that. */
      windowSize={21}
      /* Same reason, second half: these cells CHANGE HEIGHT on expand, and Android's
         default removeClippedSubviews={true} detaches/reattaches native views around
         measurements it took at the old height. index.tsx:211 opts out for a different
         reason (Reanimated Swipeable); this surface is the only one with variable-height
         cells. */
      removeClippedSubviews={false}
    />
  );
}
