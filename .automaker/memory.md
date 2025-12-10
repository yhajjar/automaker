# Agent Memory - Lessons Learned

This file documents issues encountered by previous agents and their solutions. Read this before starting work to avoid repeating mistakes.

## Testing Issues

### Issue: Mock project setup not navigating to board view

**Problem:** Setting `currentProject` in localStorage didn't automatically show the board view - app stayed on welcome view.
**Fix:** The `currentView` state is not persisted in localStorage. Instead of trying to set it, have tests click on the recent project from the welcome view to trigger `setCurrentProject()` which handles the view transition properly.

```typescript
// Don't do this:
await setupMockProject(page); // Sets localStorage
await page.goto("/");
await waitForElement(page, "board-view"); // ❌ Fails - still on welcome view

// Do this instead:
await setupMockProject(page);
await page.goto("/");
await waitForElement(page, "welcome-view");
const recentProject = page.locator(
  '[data-testid="recent-project-test-project-1"]'
);
await recentProject.click(); // ✅ Triggers proper view transition
await waitForElement(page, "board-view");
```

### Issue: View output button test IDs are conditional

**Problem:** Tests failed looking for `view-output-inprogress-${featureId}` when the actual button had `view-output-${featureId}`.
**Fix:** The button test ID depends on whether the feature is actively running:

- `view-output-${featureId}` - shown when feature is in `runningAutoTasks` (actively running)
- `view-output-inprogress-${featureId}` - shown when status is "in_progress" but NOT actively running

After dragging a feature to in_progress, wait for the `auto_mode_feature_start` event to fire before looking for the button:

```typescript
// Wait for feature to start running
const viewOutputButton = page
  .locator(
    `[data-testid="view-output-${featureId}"], [data-testid="view-output-inprogress-${featureId}"]`
  )
  .first();
await expect(viewOutputButton).toBeVisible({ timeout: 8000 });
```

### Issue: Elements not appearing due to async event timing

**Problem:** Tests checked for UI elements before async events (like `auto_mode_feature_start`) had fired and updated the UI.
**Fix:** Add appropriate timeouts when waiting for elements that depend on async events. The mock auto mode takes ~2.4 seconds to complete, so allow sufficient time:

```typescript
// Mock auto mode timing: ~2.4s + 1.5s delay = ~4s total
await waitForAgentOutputModalHidden(page, { timeout: 10000 });
```

### Issue: Slider interaction testing

**Problem:** Clicking on slider track didn't reliably set specific values.
**Fix:** Use the slider's keyboard interaction or calculate the exact click position on the track. For max value, click on the rightmost edge of the track.

### Issue: Port binding blocked in sandbox mode

**Problem:** Playwright tests couldn't bind to port in sandbox mode.
**Fix:** Tests don't need sandbox disabled - the issue was TEST_REUSE_SERVER environment variable. Make sure to start the dev server separately or let Playwright's webServer config handle it.

## Code Architecture

### Issue: Understanding store state persistence

**Problem:** Not all store state is persisted to localStorage.
**Fix:** Check the `partialize` function in `app-store.ts` to see which state is persisted:

```typescript
partialize: (state) => ({
  projects: state.projects,
  currentProject: state.currentProject,
  theme: state.theme,
  sidebarOpen: state.sidebarOpen,
  apiKeys: state.apiKeys,
  chatSessions: state.chatSessions,
  chatHistoryOpen: state.chatHistoryOpen,
  maxConcurrency: state.maxConcurrency, // Added for concurrency feature
});
```

Note: `currentView` is NOT persisted - it's managed through actions.

### Issue: Auto mode task lifecycle

**Problem:** Confusion about when features are considered "running" vs "in_progress".
**Fix:** Understand the task lifecycle:

1. Feature dragged to "in_progress" column → status becomes "in_progress"
2. `auto_mode_feature_start` event fires → feature added to `runningAutoTasks`
3. Agent works on feature → periodic events sent
4. `auto_mode_feature_complete` event fires → feature removed from `runningAutoTasks`
5. If `passes: true` → status becomes "verified", if `passes: false` → stays "in_progress"

### Issue: waiting_approval features not draggable when skipTests=true

**Problem:** Features in `waiting_approval` status couldn't be dragged to `verified` column, even though the code appeared to handle it.
**Fix:** The order of condition checks in `handleDragEnd` matters. The `skipTests` check was catching `waiting_approval` features before the `waiting_approval` status check could handle them. Move the `waiting_approval` status check **before** the `skipTests` check in `board-view.tsx`:

```typescript
// Correct order in handleDragEnd:
if (draggedFeature.status === "backlog") {
  // ...
} else if (draggedFeature.status === "waiting_approval") {
  // Handle waiting_approval BEFORE skipTests check
  // because waiting_approval features often have skipTests=true
} else if (draggedFeature.skipTests) {
  // Handle other skipTests features
}
```

## Best Practices Discovered

### Testing utilities are critical

Create comprehensive testing utilities in `tests/utils.ts` to avoid repeating selector logic:

- `waitForElement` - waits for elements to appear
- `waitForElementHidden` - waits for elements to disappear
- `setupMockProject` - sets up mock localStorage state
- `navigateToBoard` - handles navigation from welcome to board view

### Always add data-testid attributes

When implementing features, immediately add `data-testid` attributes to key UI elements. This makes tests more reliable and easier to write.

### Test timeouts should be generous but not excessive

- Default timeout: 30s (set in playwright.config.ts)
- Element waits: 5-15s for critical elements
- Auto mode completion: 10s (accounts for ~4s mock duration)
- Don't increase timeouts past 10s for individual operations

### Mock auto mode timing

The mock auto mode in `electron.ts` has predictable timing:

- Total duration: ~2.4 seconds (300+500+300+300+500+500ms)
- Plus 1.5s delay before auto-closing modals
- Total: ~4 seconds from start to completion

### Issue: HotkeyButton conflicting with useKeyboardShortcuts

**Problem:** Adding `HotkeyButton` with a simple key (like "N") to buttons that already had keyboard shortcuts registered via `useKeyboardShortcuts` caused the hotkey to stop working. Both registered duplicate listeners, and the HotkeyButton's `stopPropagation()` call could interfere.
**Fix:** When a simple single-key hotkey is already handled by `useKeyboardShortcuts`, set `hotkeyActive={false}` on the `HotkeyButton` so it only displays the indicator badge without registering a duplicate listener:

```tsx
// In views that already use useKeyboardShortcuts for the "N" key:
<HotkeyButton
  onClick={() => setShowAddDialog(true)}
  hotkey={shortcuts.addFeature}
  hotkeyActive={false}  // <-- Important! Prevents duplicate listener
>
  Add Feature
</HotkeyButton>

// HotkeyButton should only actively listen when it's the sole handler (e.g., Cmd+Enter in dialogs)
<HotkeyButton
  onClick={handleSubmit}
  hotkey={{ key: "Enter", cmdCtrl: true }}
  hotkeyActive={isDialogOpen}  // Active when dialog is open
>
  Submit
</HotkeyButton>
```
