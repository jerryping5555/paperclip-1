import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Inbox, ListChecks } from "lucide-react";
import type { Agent, AttentionItem, AttentionSubject, BulkDecisionItemResult } from "@paperclipai/shared";
import { useNavigate, useSearchParams } from "@/lib/router";
import { attentionApi } from "../api/attention";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { decisionsApi } from "../api/decisions";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { useInboxDismissals } from "../hooks/useInboxBadge";
import { queryKeys } from "../lib/queryKeys";
import {
  ATTENTION_AGING_DAYS,
  attentionIsAging,
  buildAttentionFilterOptions,
  defaultAttentionFilterState,
  filterAttentionItems,
  groupAttentionItems,
  isInlineResolvable,
  loadAttentionFilters,
  loadAttentionGroupBy,
  loadAttentionSortOrder,
  loadCollapsedAttentionGroupKeys,
  buildDeskShelves,
  planAttentionRenderRows,
  resolveAttentionDateRange,
  saveAttentionFilters,
  saveAttentionGroupBy,
  saveAttentionSortOrder,
  saveCollapsedAttentionGroupKeys,
  sortAttentionItems,
  type AttentionDateRangeId,
  type AttentionFilterState,
  type AttentionGroup,
  type AttentionGroupBy,
  type AttentionSortOrder,
} from "../lib/attention";
import { hasBlockingShortcutDialog, resolveAttentionQueueKeyAction } from "../lib/keyboardShortcuts";
import { PageSkeleton } from "../components/PageSkeleton";
import { AttentionQueueRow } from "../components/AttentionQueueRow";
import { DecisionsToolbar } from "../components/DecisionsToolbar";
import { Curtain, AgingItemRow } from "../components/DecisionShelf";
import { DecisionQueueRail } from "../components/DecisionQueueRail";
import { DecisionDateChips, type AttentionCustomRange } from "../components/DecisionDateChips";
import { DecisionResolver } from "../components/DecisionResolver";
import { IssueGroupHeader } from "../components/IssueGroupHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Curtain rows never expand; module-level so memoized rows see one identity. */
const noopToggleExpand = () => {};

// Incremental rendering (PAP-13784, same pattern as IssuesList): the feed is
// uncapped, so mounting every row up front makes the page slow to paint and
// scroll. Render a bounded window and grow it as the scroll position nears the
// bottom. One budget spans the active groups and the open curtains in document
// order, so everything below the fold stays unmounted until needed.
const INITIAL_ATTENTION_ROW_RENDER_LIMIT = 50;
const ATTENTION_ROW_RENDER_BATCH_SIZE = 100;
const ATTENTION_SCROLL_LOAD_THRESHOLD_PX = 480;
const DECISION_HISTORY_VISIBLE_LIMIT = 50;
const DECISION_HISTORY_QUERY_LIMIT = DECISION_HISTORY_VISIBLE_LIMIT + 1;

export function decisionHistoryQueryEnabled(companyId: string | null | undefined, open: boolean) {
  return Boolean(companyId && open);
}

export function decisionHistoryCount(count: number | undefined) {
  if (count == null) return undefined;
  return count > DECISION_HISTORY_VISIBLE_LIMIT ? `${DECISION_HISTORY_VISIBLE_LIMIT}+` : count;
}

function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element || typeof window === "undefined") return null;
  let current = element.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function WhatNeedsMe() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedAttentionId, setSelectedAttentionId] = useState<string | null>(null);
  // How the current selection was made. The selection ring is the keyboard
  // cursor — it marks the row that j/k, e, x and s will act on — so it is drawn
  // only for a keyboard-driven selection. Clicking used to set it too, which
  // put a ring around the card for no reason the operator could act on, and
  // only ever on rows with a See more/less toggle to click (the toggle is what
  // set it), so the queue looked arbitrarily inconsistent. The selection itself
  // still follows a click, so keyboard actions target the row you just used.
  const [selectionFromKeyboard, setSelectionFromKeyboard] = useState(false);
  const [autoExpandDone, setAutoExpandDone] = useState(false);
  // Toolbar preferences (persisted to localStorage, Inbox pattern).
  const [groupBy, setGroupBy] = useState<AttentionGroupBy>(() => loadAttentionGroupBy());
  const [sortOrder, setSortOrder] = useState<AttentionSortOrder>(() => loadAttentionSortOrder());
  const [filters, setFilters] = useState<AttentionFilterState>(() => defaultAttentionFilterState);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [agingOpen, setAgingOpen] = useState(false);
  const [decidedOpen, setDecidedOpen] = useState(false);
  const [expiredOpen, setExpiredOpen] = useState(false);
  const [decisionSelectMode, setDecisionSelectMode] = useState(false);
  const [selectedDecisionIds, setSelectedDecisionIds] = useState<Set<string>>(() => new Set());
  const [showDecisionDeleteConfirm, setShowDecisionDeleteConfirm] = useState(false);

  // Date-range chips (PAP-16032 §4.2) — resolve to server-side activity bounds.
  const [dateRange, setDateRange] = useState<AttentionDateRangeId>("all");
  const [customRange, setCustomRange] = useState<AttentionCustomRange>({ from: null, to: null });

  // `?decisionId=` deep link (PAP-16032 §4.7) — focus/expand the referenced card.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkDecisionId = searchParams.get("decisionId");
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false);

  // Optimistic hide/restore. Reset whenever a fresh feed lands (server truth).
  const [pendingHide, setPendingHide] = useState<Set<string>>(() => new Set());
  const [pendingRestore, setPendingRestore] = useState<Set<string>>(() => new Set());

  const { dismiss, snooze, restore } = useInboxDismissals(selectedCompanyId);
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Date chips resolve to server-side activity bounds. Anchored to start-of-day,
  // so the resolved ISO strings are stable across renders within the same day —
  // safe to key the feed query on without thrashing.
  const activityBounds = useMemo(
    () => resolveAttentionDateRange(dateRange, Date.now(), customRange),
    [dateRange, customRange],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Decisions" }]);
  }, [setBreadcrumbs]);

  // Re-hydrate per-company preferences when the company changes.
  useEffect(() => {
    setFilters(loadAttentionFilters(selectedCompanyId));
    setCollapsedGroupKeys(loadCollapsedAttentionGroupKeys(selectedCompanyId));
  }, [selectedCompanyId]);

  const {
    data: feed,
    isLoading,
    error,
  } = useQuery({
    // Distinct from the sidebar badge's `queryKeys.attention` so dismissed rows
    // (needed for the curtains) never inflate the badge count. Invalidating the
    // `["attention", companyId]` prefix still cascades to this query.
    queryKey: [
      ...queryKeys.attention(selectedCompanyId!),
      "with-dismissed",
      activityBounds.activitySince ?? null,
      activityBounds.activityUntil ?? null,
    ],
    queryFn: () => attentionApi.list(selectedCompanyId!, {
      includeDismissed: true,
      all: true,
      ...activityBounds,
    }),
    enabled: !!selectedCompanyId,
    refetchOnWindowFocus: true,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Decision history — decided / expired decisions leave the open attention
  // feed (entryRule = open only), so we fetch them directly for the curtains.
  const { data: decidedDecisions, isLoading: decidedDecisionsLoading } = useQuery({
    queryKey: queryKeys.decisions.list(selectedCompanyId!, "decided"),
    queryFn: () => decisionsApi.list(selectedCompanyId!, { status: "decided", limit: DECISION_HISTORY_QUERY_LIMIT }),
    enabled: decisionHistoryQueryEnabled(selectedCompanyId, decidedOpen),
  });
  const { data: expiredDecisions, isLoading: expiredDecisionsLoading } = useQuery({
    queryKey: queryKeys.decisions.list(selectedCompanyId!, "expired"),
    queryFn: () => decisionsApi.list(selectedCompanyId!, { status: "expired", limit: DECISION_HISTORY_QUERY_LIMIT }),
    enabled: decisionHistoryQueryEnabled(selectedCompanyId, expiredOpen),
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) map.set(agent.id, agent);
    return map;
  }, [agents]);

  // Reset optimistic state once the server sends a fresh snapshot.
  useEffect(() => {
    setPendingHide(new Set());
    setPendingRestore(new Set());
  }, [feed?.generatedAt]);

  const allItems = useMemo(() => feed?.items ?? [], [feed]);

  const isServerHidden = (item: AttentionItem) => item.dismissal != null && item.dismissal.isActive;

  const activeItems = useMemo(
    () =>
      allItems.filter(
        (item) => (!isServerHidden(item) || pendingRestore.has(item.id)) && !pendingHide.has(item.id),
      ),
    [allItems, pendingHide, pendingRestore],
  );

  // The server's clock at feed time — used for the arrival/decide-by shelves and
  // the aging idle labels so they match `deskBadgeCount` and the sidebar badge
  // exactly, and stay stable across renders (Date.now() only as a pre-load fallback).
  const now = useMemo(
    () => (feed?.generatedAt ? new Date(feed.generatedAt).getTime() : Date.now()),
    [feed?.generatedAt],
  );

  // Aging shelf (§4.4): items the server flags as idle past retention leave the
  // live desk for their own curtain, so today's desk shows only fresh decisions.
  const agingItems = useMemo(() => activeItems.filter(attentionIsAging), [activeItems]);
  const deskItems = useMemo(() => activeItems.filter((item) => !attentionIsAging(item)), [activeItems]);
  const snoozedItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          item.dismissal?.kind === "snooze" && item.dismissal.isActive && !pendingRestore.has(item.id),
      ),
    [allItems, pendingRestore],
  );
  const dismissedItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          item.dismissal?.kind === "dismiss" && item.dismissal.isActive && !pendingRestore.has(item.id),
      ),
    [allItems, pendingRestore],
  );

  const filterOptions = useMemo(() => buildAttentionFilterOptions(deskItems), [deskItems]);

  // Filter → sort → group, all client-side so switching re-buckets without a
  // refetch. In the default (ungrouped) view the desk groups by arrival —
  // "New today" then "Earlier" — with a "Decide now" shelf only when something
  // carries an explicit, due decide-by. Any explicit
  // group-by keeps the Inbox-style activity grouping.
  const groups = useMemo<AttentionGroup[]>(() => {
    const filtered = filterAttentionItems(deskItems, filters);
    if (groupBy === "none") {
      return buildDeskShelves(filtered, now);
    }
    const sorted = sortAttentionItems(filtered, sortOrder);
    return groupAttentionItems(sorted, groupBy);
  }, [deskItems, filters, sortOrder, groupBy, now]);

  const visibleCount = useMemo(() => groups.reduce((sum, group) => sum + group.items.length, 0), [groups]);
  const keyboardItems = useMemo(
    () => groups.filter((group) => group.label === null || !collapsedGroupKeys.has(group.key)).flatMap((group) => group.items),
    [collapsedGroupKeys, groups],
  );

  // Rendered-row budget: only ratchets up (a hard reset mid-scroll would yank
  // the DOM out from under the user), and resets when the company changes.
  const [renderedRowLimit, setRenderedRowLimit] = useState(INITIAL_ATTENTION_ROW_RENDER_LIMIT);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setRenderedRowLimit(INITIAL_ATTENTION_ROW_RENDER_LIMIT);
  }, [selectedCompanyId]);

  // Keyboard selection may point past the budget (e.g. wrapping to the last
  // row), so the effective limit is derived to always cover it — the selected
  // row is then guaranteed to be in the DOM in the same commit that selects it.
  const renderPlan = useMemo(() => {
    const selectedIndex = selectedAttentionId
      ? keyboardItems.findIndex((item) => item.id === selectedAttentionId)
      : -1;
    return planAttentionRenderRows({
      groups,
      collapsedGroupKeys,
      snoozedItems,
      snoozedOpen,
      dismissedItems,
      dismissedOpen,
      limit: Math.max(renderedRowLimit, selectedIndex + 1),
    });
  }, [
    collapsedGroupKeys,
    dismissedItems,
    dismissedOpen,
    groups,
    keyboardItems,
    renderedRowLimit,
    selectedAttentionId,
    snoozedItems,
    snoozedOpen,
  ]);

  const loadMoreRows = useCallback(() => {
    setRenderedRowLimit((current) => current + ATTENTION_ROW_RENDER_BATCH_SIZE);
  }, []);

  useEffect(() => {
    if (!renderPlan.hasMoreRows) return;
    let animationFrameId: number | null = null;
    const scrollContainer = findScrollContainer(rootRef.current);
    const scrollTarget: Window | HTMLElement = scrollContainer ?? window;

    const checkScrollPosition = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        const scrollHeight = scrollContainer?.scrollHeight ?? document.documentElement.scrollHeight;
        if (scrollHeight === 0) return;
        const scrollBottom = scrollContainer
          ? scrollContainer.scrollTop + scrollContainer.clientHeight
          : window.scrollY + window.innerHeight;
        if (scrollBottom >= scrollHeight - ATTENTION_SCROLL_LOAD_THRESHOLD_PX) {
          loadMoreRows();
        }
      });
    };

    scrollTarget.addEventListener("scroll", checkScrollPosition, { passive: true });
    window.addEventListener("resize", checkScrollPosition);
    // Initial check: a tall viewport (or an opened curtain) may need more rows
    // than the current budget before any scrolling happens.
    checkScrollPosition();

    return () => {
      scrollTarget.removeEventListener("scroll", checkScrollPosition);
      window.removeEventListener("resize", checkScrollPosition);
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, [loadMoreRows, renderPlan.hasMoreRows, renderedRowLimit]);

  useEffect(() => {
    if (selectedAttentionId && !keyboardItems.some((item) => item.id === selectedAttentionId)) {
      setSelectedAttentionId(null);
      setSelectionFromKeyboard(false);
    }
  }, [keyboardItems, selectedAttentionId]);

  useEffect(() => {
    if (!selectedAttentionId) return;
    document.getElementById(`attention-row-${selectedAttentionId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedAttentionId]);

  // `?decisionId=` deep link (§4.7): focus and expand the referenced decision
  // card once the feed lands, then drop the param so a later manual collapse is
  // not re-forced on the next refetch. Wins over the generic auto-expand below.
  useEffect(() => {
    if (deepLinkConsumed || !deepLinkDecisionId || allItems.length === 0) return;
    const target = allItems.find(
      (item) => item.sourceKind === "decision" && item.subject.id === deepLinkDecisionId,
    );
    setDeepLinkConsumed(true);
    setAutoExpandDone(true);
    if (target) {
      setExpandedId(target.id);
      setSelectedAttentionId(target.id);
      setSelectionFromKeyboard(true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("decisionId");
          return next;
        },
        { replace: true },
      );
    }
  }, [allItems, deepLinkConsumed, deepLinkDecisionId, setSearchParams]);

  // Auto-expand the topmost inline-capable decision, once.
  useEffect(() => {
    if (autoExpandDone || deskItems.length === 0) return;
    const sorted = sortAttentionItems(deskItems, sortOrder);
    const topInline = sorted.find((item) => isInlineResolvable(item));
    if (topInline) setExpandedId(topInline.id);
    setAutoExpandDone(true);
  }, [deskItems, autoExpandDone, sortOrder]);

  const updateGroupBy = (next: AttentionGroupBy) => {
    setGroupBy(next);
    saveAttentionGroupBy(next);
  };
  const updateSortOrder = (next: AttentionSortOrder) => {
    setSortOrder(next);
    saveAttentionSortOrder(next);
  };
  const updateFilters = (next: AttentionFilterState) => {
    setFilters(next);
    saveAttentionFilters(selectedCompanyId, next);
  };
  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedAttentionGroupKeys(selectedCompanyId, next);
      return next;
    });
  };

  // All row callbacks are stable (deps are setState functions, stable hook
  // callbacks, and the stable `pushToast`) so the memoized rows only re-render
  // when their own item/expanded/selected props change (PAP-13784).
  const handleUndoDismiss = useCallback(
    (item: AttentionItem) => {
      setPendingHide((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      restore(item.dismissalKey);
    },
    [restore],
  );
  const handleDismiss = useCallback(
    (item: AttentionItem) => {
      setPendingHide((prev) => new Set(prev).add(item.id));
      dismiss(item.dismissalKey);
      setExpandedId((previous) => (previous === item.id ? null : previous));
      // ~8s undo window; restores the row in place via T1's DELETE endpoint.
      pushToast({
        id: `attention-dismiss-${item.id}`,
        dedupeKey: `attention-dismiss-${item.dismissalKey}`,
        title: "Dismissed",
        body: item.subject.title ?? undefined,
        tone: "info",
        ttlMs: 8000,
        action: { label: "Undo", onClick: () => handleUndoDismiss(item) },
      });
    },
    [dismiss, handleUndoDismiss, pushToast],
  );
  const handleSnooze = useCallback(
    (item: AttentionItem, snoozedUntil: string) => {
      setPendingHide((prev) => new Set(prev).add(item.id));
      snooze(item.dismissalKey, snoozedUntil);
      setExpandedId((previous) => (previous === item.id ? null : previous));
    },
    [snooze],
  );
  const handleRestore = useCallback(
    (item: AttentionItem) => {
      setPendingRestore((prev) => new Set(prev).add(item.id));
      restore(item.dismissalKey);
    },
    [restore],
  );
  const handleToggleExpand = useCallback((item: AttentionItem) => {
    setSelectedAttentionId(item.id);
    setSelectionFromKeyboard(false);
    setExpandedId((prev) => (prev === item.id ? null : item.id));
  }, []);

  const historyDecisions = useMemo(
    () => [...(decidedDecisions ?? []).slice(0, DECISION_HISTORY_VISIBLE_LIMIT), ...(expiredDecisions ?? []).slice(0, DECISION_HISTORY_VISIBLE_LIMIT)],
    [decidedDecisions, expiredDecisions],
  );
  const openFeedDecisionItems = useMemo(
    () => [...renderPlan.groupRows.values()].flat().filter((item) => item.sourceKind === "decision"),
    [renderPlan],
  );
  const selectableDecisionTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const decision of historyDecisions) map.set(decision.id, decision.title);
    for (const item of openFeedDecisionItems) map.set(item.subject.id, item.subject.title ?? item.subject.id);
    return map;
  }, [historyDecisions, openFeedDecisionItems]);

  const enterDecisionSelectMode = useCallback(() => {
    setDecidedOpen(true);
    setExpiredOpen(true);
    setSelectedDecisionIds(new Set());
    setDecisionSelectMode(true);
  }, []);
  const exitDecisionSelectMode = useCallback(() => {
    setDecisionSelectMode(false);
    setSelectedDecisionIds(new Set());
  }, []);

  const toggleSelectedDecisionId = useCallback((decisionId: string) => {
    setSelectedDecisionIds((prev) => {
      const next = new Set(prev);
      if (next.has(decisionId)) next.delete(decisionId);
      else next.add(decisionId);
      return next;
    });
  }, []);

  const bulkDeleteDecisionsMutation = useMutation({
    mutationFn: async (decisionIds: string[]) => {
      const allResults: BulkDecisionItemResult[] = [];
      for (let start = 0; start < decisionIds.length; start += 100) {
        const response = await decisionsApi.bulkDelete(selectedCompanyId!, decisionIds.slice(start, start + 100));
        allResults.push(...response.results);
      }
      return allResults;
    },
    onSuccess: async (results) => {
      const deletedCount = results.filter((result) => result.ok).length;
      const failedResults = results.filter((result) => !result.ok);
      setSelectedDecisionIds(new Set());
      setDecisionSelectMode(false);
      await queryClient.invalidateQueries({ queryKey: ["decisions", selectedCompanyId!] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.attention(selectedCompanyId!) });
      if (failedResults.length === 0) {
        pushToast({
          title: `Deleted ${deletedCount} decision ${deletedCount === 1 ? "record" : "records"}`,
          tone: "success",
        });
      } else {
        const failedSummary = failedResults
          .slice(0, 5)
          .map((result) => `"${selectableDecisionTitleById.get(result.decisionId) ?? result.decisionId.slice(0, 8)}" ${result.error?.message ?? "unknown error"}`)
          .join("; ");
        pushToast({
          title: `Deleted ${deletedCount} of ${results.length}`,
          body: `Could not delete: ${failedSummary}${failedResults.length > 5 ? "; …" : ""}`,
          tone: "error",
        });
      }
    },
    onError: (err) => {
      pushToast({
        title: "Bulk delete failed",
        body: err instanceof Error ? err.message : "Unable to delete decisions",
        tone: "error",
      });
    },
  });

  const bulkDismissDecisionsMutation = useMutation({
    mutationFn: async (decisionIds: string[]) => {
      const allResults: BulkDecisionItemResult[] = [];
      for (let start = 0; start < decisionIds.length; start += 100) {
        const response = await decisionsApi.bulkDismiss(selectedCompanyId!, decisionIds.slice(start, start + 100));
        allResults.push(...response.results);
      }
      return allResults;
    },
    onSuccess: async (results) => {
      const dismissedCount = results.filter((result) => result.ok).length;
      const failedResults = results.filter((result) => !result.ok);
      setSelectedDecisionIds(new Set());
      setDecisionSelectMode(false);
      await queryClient.invalidateQueries({ queryKey: ["decisions", selectedCompanyId!] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.attention(selectedCompanyId!) });
      if (failedResults.length === 0) {
        pushToast({
          title: `Dismissed ${dismissedCount} decision ${dismissedCount === 1 ? "record" : "records"}`,
          tone: "success",
        });
      } else {
        const reasonFor = (result: BulkDecisionItemResult) =>
          result.error?.code === "decision_already_resolved" ? "already closed" : (result.error?.message ?? "unknown error");
        const failedSummary = failedResults
          .slice(0, 5)
          .map((result) => `"${selectableDecisionTitleById.get(result.decisionId) ?? result.decisionId.slice(0, 8)}" ${reasonFor(result)}`)
          .join("; ");
        pushToast({
          title: `Dismissed ${dismissedCount} of ${results.length}`,
          body: `Could not dismiss: ${failedSummary}${failedResults.length > 5 ? "; …" : ""}`,
          tone: "error",
        });
      }
    },
    onError: (err) => {
      pushToast({
        title: "Bulk dismiss failed",
        body: err instanceof Error ? err.message : "Unable to dismiss decisions",
        tone: "error",
      });
    },
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveAttentionQueueKeyAction({
        defaultPrevented: event.defaultPrevented,
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target: event.target,
        hasOpenDialog: hasBlockingShortcutDialog(document),
        hasSelection: selectedAttentionId !== null,
      });
      if (action === "ignore" || keyboardItems.length === 0) return;

      if (action === "next" || action === "previous") {
        event.preventDefault();
        const currentIndex = selectedAttentionId ? keyboardItems.findIndex((item) => item.id === selectedAttentionId) : -1;
        const offset = action === "next" ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? action === "next"
            ? 0
            : keyboardItems.length - 1
          : (currentIndex + offset + keyboardItems.length) % keyboardItems.length;
        setSelectedAttentionId(keyboardItems[nextIndex]?.id ?? null);
        setSelectionFromKeyboard(true);
        return;
      }

      const selectedItem = keyboardItems.find((item) => item.id === selectedAttentionId);
      if (!selectedItem) return;
      event.preventDefault();

      if (action === "dismiss") {
        handleDismiss(selectedItem);
      } else if (isInlineResolvable(selectedItem)) {
        setExpandedId((previous) => (previous === selectedItem.id ? null : selectedItem.id));
      } else if (selectedItem.subject.href) {
        navigate(selectedItem.subject.href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDismiss, keyboardItems, navigate, selectedAttentionId]);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select an organization first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  const hasAnything = activeItems.length > 0 || snoozedItems.length > 0 || dismissedItems.length > 0;

  return (
    <div ref={rootRef} className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Decisions</h1>
        <DecisionsToolbar
          visibleCount={visibleCount}
          filterOptions={filterOptions}
          filters={filters}
          onFiltersChange={updateFilters}
          groupBy={groupBy}
          onGroupByChange={updateGroupBy}
          sortOrder={sortOrder}
          onSortOrderChange={updateSortOrder}
        />
      </div>

      {/* Queue quicklinks + date-range chips (§4.1–§4.2). The rail self-hides
          when the company has no queues; the chips filter the desk server-side. */}
      <div className="space-y-2">
        <DecisionQueueRail companyId={selectedCompanyId} activeQueueKey={null} />
        <DecisionDateChips
          value={dateRange}
          custom={customRange}
          onChange={(value, custom) => {
            setDateRange(value);
            setCustomRange(custom);
          }}
        />
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {!hasAnything ? (
        <ZeroState />
      ) : (
        <div className="space-y-4">
          {visibleCount === 0 ? (
            <CaughtUpNote filtered={deskItems.length > 0} />
          ) : (
            <>
              {groups.map((group) => {
              const groupLabel = group.label;
              const collapsed = groupLabel !== null && collapsedGroupKeys.has(group.key);
              return (
                <section key={group.key} className="space-y-2">
                  {groupLabel !== null && (
                    <IssueGroupHeader
                      label={groupLabel}
                      collapsible
                      collapsed={collapsed}
                      onToggle={() => toggleGroupCollapse(group.key)}
                      trailing={
                        <span className="text-xs tabular-nums text-muted-foreground">{group.items.length}</span>
                      }
                    />
                  )}
                  {!collapsed && (
                    <div className="space-y-4">
                      {(() => {
                        const rows = renderPlan.groupRows.get(group.key) ?? [];
                        const seenBundles = new Set<string>();
                        return rows.map((item) => {
                          const bundleId =
                            item.sourceKind === "decision"
                              ? ((item.subject.metadata?.bundleId as string | null | undefined) ?? null)
                              : null;
                          let header: ReactNode = null;
                          if (bundleId && !seenBundles.has(bundleId)) {
                            seenBundles.add(bundleId);
                            const bundleRows = rows.filter(
                              (row) =>
                                row.sourceKind === "decision" &&
                                ((row.subject.metadata?.bundleId as string | null | undefined) ?? null) === bundleId,
                            );
                            const first = bundleRows[0];
                            header = (
                              <DecisionBundleHeader
                                agentName={agentMap.get(first?.subject.metadata?.originAgentId as string)?.name ?? null}
                                title={(first?.subject.metadata?.bundleTitle as string | null | undefined) ?? null}
                                originIssue={first?.relatedIssue ?? null}
                                count={bundleRows.length}
                              />
                            );
                          }
                          return (
                            <Fragment key={item.id}>
                              {header}
                              <div className={bundleId ? "border-l-2 border-violet-500/40 pl-3" : undefined}>
                                {decisionSelectMode && item.sourceKind === "decision" ? (
                                  <div className="flex items-start gap-2">
                                    <Checkbox
                                      checked={selectedDecisionIds.has(item.subject.id)}
                                      onCheckedChange={() => toggleSelectedDecisionId(item.subject.id)}
                                      aria-label={`Select ${item.subject.title ?? "decision"}`}
                                      data-testid="decision-bulk-select-checkbox"
                                      className="mt-1 shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <AttentionQueueRow
                                        item={item}
                                        companyId={selectedCompanyId}
                                        expanded={expandedId === item.id}
                                        onToggleExpand={handleToggleExpand}
                                        onDismiss={handleDismiss}
                                        onSnooze={handleSnooze}
                                        agentMap={agentMap}
                                        agents={agents}
                                        showTriage
                                        currentUserId={currentUserId}
                                        selected={selectionFromKeyboard && selectedAttentionId === item.id}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <AttentionQueueRow
                                    item={item}
                                    companyId={selectedCompanyId}
                                    expanded={expandedId === item.id}
                                    onToggleExpand={handleToggleExpand}
                                    onDismiss={handleDismiss}
                                    onSnooze={handleSnooze}
                                    agentMap={agentMap}
                                    agents={agents}
                                    showTriage
                                    currentUserId={currentUserId}
                                    selected={selectionFromKeyboard && selectedAttentionId === item.id}
                                  />
                                )}
                              </div>
                            </Fragment>
                          );
                        });
                      })()}
                    </div>
                  )}
                </section>
              );
              })}
            </>
          )}

          {snoozedItems.length > 0 && (
            <Curtain
              label="Snoozed"
              count={snoozedItems.length}
              open={snoozedOpen}
              onToggle={() => setSnoozedOpen((prev) => !prev)}
            >
              {renderPlan.snoozedRows.map((item) => (
                <AttentionQueueRow
                  key={item.id}
                  item={item}
                  companyId={selectedCompanyId}
                  variant="hidden"
                  expanded={false}
                  onToggleExpand={noopToggleExpand}
                  onDismiss={handleDismiss}
                  onRestore={handleRestore}
                  agentMap={agentMap}
                  currentUserId={currentUserId}
                />
              ))}
            </Curtain>
          )}

          {dismissedItems.length > 0 && (
            <Curtain
              label="Dismissed"
              count={dismissedItems.length}
              open={dismissedOpen}
              onToggle={() => setDismissedOpen((prev) => !prev)}
            >
              {renderPlan.dismissedRows.map((item) => (
                <AttentionQueueRow
                  key={item.id}
                  item={item}
                  companyId={selectedCompanyId}
                  variant="hidden"
                  expanded={false}
                  onToggleExpand={noopToggleExpand}
                  onDismiss={handleDismiss}
                  onRestore={handleRestore}
                  agentMap={agentMap}
                  currentUserId={currentUserId}
                />
              ))}
            </Curtain>
          )}

          {agingItems.length > 0 && (
            <Curtain
              label="Aging"
              count={agingItems.length}
              open={agingOpen}
              onToggle={() => setAgingOpen((prev) => !prev)}
            >
              <p className="text-xs text-muted-foreground">
                Idle past {ATTENTION_AGING_DAYS} days — kept off the desk. Keep any you still want surfaced.
              </p>
              {agingItems.map((item) => (
                <AgingItemRow
                  key={item.id}
                  item={item}
                  companyId={selectedCompanyId}
                  now={now}
                  agentMap={agentMap}
                  agents={agents}
                  currentUserId={currentUserId}
                  expanded={expandedId === item.id}
                  onToggleExpand={handleToggleExpand}
                  onDismiss={handleDismiss}
                  onSnooze={handleSnooze}
                />
              ))}
            </Curtain>
          )}

        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {decisionSelectMode ? (
            <div
              className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur"
              data-testid="decision-bulk-bar"
            >
              <span className="mr-auto text-sm text-muted-foreground">
                {selectedDecisionIds.size} selected
              </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedDecisionIds(new Set([
                    ...historyDecisions.map((decision) => decision.id),
                    ...openFeedDecisionItems.map((item) => item.subject.id),
                  ]))}
                >
                  Select all
                </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedDecisionIds(new Set())}
                disabled={selectedDecisionIds.size === 0}
              >
                Deselect all
              </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => bulkDismissDecisionsMutation.mutate([...selectedDecisionIds])}
                  disabled={selectedDecisionIds.size === 0 || bulkDismissDecisionsMutation.isPending}
                >
                  {bulkDismissDecisionsMutation.isPending ? "Dismissing…" : "Dismiss"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowDecisionDeleteConfirm(true)}
                  disabled={selectedDecisionIds.size === 0 || bulkDeleteDecisionsMutation.isPending}
                >
                  Delete…
                </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={exitDecisionSelectMode}
              >
                Done
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={decisionSelectMode}
              data-testid="decision-bulk-select-toggle"
              onClick={enterDecisionSelectMode}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Select
            </Button>
          )}
        </div>

        <Dialog open={showDecisionDeleteConfirm} onOpenChange={setShowDecisionDeleteConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete selected decision records?</DialogTitle>
              <DialogDescription>
                This permanently deletes {selectedDecisionIds.size} selected decision{" "}
                {selectedDecisionIds.size === 1 ? "record" : "records"} and their execution
                history. Tasks blocked by these records become deletable. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDecisionDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={selectedDecisionIds.size === 0 || bulkDeleteDecisionsMutation.isPending}
                onClick={() => {
                  setShowDecisionDeleteConfirm(false);
                  bulkDeleteDecisionsMutation.mutate([...selectedDecisionIds]);
                }}
              >
                {bulkDeleteDecisionsMutation.isPending
                  ? "Deleting…"
                  : `Delete ${selectedDecisionIds.size} ${selectedDecisionIds.size === 1 ? "record" : "records"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Curtain
          label="Decided"
          count={decisionHistoryCount(decidedDecisions?.length)}
          open={decidedOpen}
          onToggle={() => setDecidedOpen((prev) => !prev)}
        >
          {decidedDecisionsLoading ? (
            <p className="text-xs text-muted-foreground">Loading decided decisions…</p>
          ) : (decidedDecisions?.length ?? 0) > 0 ? (
            decidedDecisions!.slice(0, DECISION_HISTORY_VISIBLE_LIMIT).map((decision) => (
              <div key={decision.id} className={decisionSelectMode ? "flex items-start gap-2" : undefined}>
                {decisionSelectMode ? (
                  <Checkbox
                    checked={selectedDecisionIds.has(decision.id)}
                    onCheckedChange={() => toggleSelectedDecisionId(decision.id)}
                    aria-label={`Select ${decision.title}`}
                    data-testid="decision-bulk-select-checkbox"
                    className="mt-1 shrink-0"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <DecisionResolver
                    companyId={selectedCompanyId}
                    decisionId={decision.id}
                    agentMap={agentMap}
                    initialDecision={{ ...decision, executions: decision.executions ?? [] }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No decided decisions.</p>
          )}
        </Curtain>

        <Curtain
          label="Expired"
          count={decisionHistoryCount(expiredDecisions?.length)}
          open={expiredOpen}
          onToggle={() => setExpiredOpen((prev) => !prev)}
        >
          {expiredDecisionsLoading ? (
            <p className="text-xs text-muted-foreground">Loading expired decisions…</p>
          ) : (expiredDecisions?.length ?? 0) > 0 ? (
            expiredDecisions!.slice(0, DECISION_HISTORY_VISIBLE_LIMIT).map((decision) => (
              <div key={decision.id} className={decisionSelectMode ? "flex items-start gap-2" : undefined}>
                {decisionSelectMode ? (
                  <Checkbox
                    checked={selectedDecisionIds.has(decision.id)}
                    onCheckedChange={() => toggleSelectedDecisionId(decision.id)}
                    aria-label={`Select ${decision.title}`}
                    data-testid="decision-bulk-select-checkbox"
                    className="mt-1 shrink-0"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <DecisionResolver
                    companyId={selectedCompanyId}
                    decisionId={decision.id}
                    agentMap={agentMap}
                    initialDecision={{ ...decision, executions: decision.executions ?? [] }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No expired decisions.</p>
          )}
        </Curtain>
      </div>
    </div>
  );
}

/**
 * Violet left-rule strip over a run of decisions that share a bundle, e.g.
 * "Planner proposed 6 decisions · from PAP-123 · routing review · 6 pending".
 * Grouping is a surface only — each decision is still decided independently.
 */
export function DecisionBundleHeader({
  agentName,
  title,
  originIssue,
  count,
}: {
  agentName: string | null;
  title: string | null;
  originIssue: AttentionSubject | null;
  count: number;
}) {
  const noun = count === 1 ? "decision" : "decisions";
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-sm border-l-2 border-violet-500/60 bg-violet-500/5 px-3 py-1.5 text-xs">
      <span className="font-semibold text-violet-800 dark:text-violet-200">
        {agentName ?? "An agent"} proposed {count} {noun}
      </span>
      {originIssue && (originIssue.identifier || originIssue.title) && (
        <span className="text-muted-foreground">
          {"· from "}
          {originIssue.href ? (
            <a href={originIssue.href} className="hover:underline">
              {originIssue.identifier ?? originIssue.title}
            </a>
          ) : (
            originIssue.identifier ?? originIssue.title
          )}
        </span>
      )}
      {title && <span className="text-muted-foreground">· {title}</span>}
      <span className="text-muted-foreground">· {count} pending</span>
    </div>
  );
}

function CaughtUpNote({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {filtered ? "No decisions match your filters." : "You're all caught up."}
      </p>
      {filtered && (
        <p className="mt-1 text-xs text-muted-foreground">Adjust or clear the filters to see the rest.</p>
      )}
    </div>
  );
}

function ZeroState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
      <div className="mb-4 rounded-full bg-green-500/10 p-4">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
      </div>
      <p className="text-lg font-semibold text-foreground">You're all caught up</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Inbox className="h-4 w-4" />
        Nothing needs a decision from you right now.
      </p>
    </div>
  );
}
