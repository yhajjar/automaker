# Phase 5: Log Parser Integration

**Status:** `completed`
**Dependencies:** Phase 2 (Provider), Phase 3 (Factory)
**Estimated Effort:** Small (parser extension)

---

## Objective

Update the log parser to recognize and normalize Cursor CLI stream events for display in the log viewer.

---

## Tasks

### Task 5.1: Add Cursor Event Type Detection

**Status:** `completed`

**File:** `apps/ui/src/lib/log-parser.ts`

Add Cursor event detection and normalization:

```typescript
import {
  CursorStreamEvent,
  CursorSystemEvent,
  CursorAssistantEvent,
  CursorToolCallEvent,
  CursorResultEvent,
} from '@automaker/types';

/**
 * Detect if a parsed JSON object is a Cursor stream event
 */
function isCursorEvent(obj: any): obj is CursorStreamEvent {
  return (
    obj &&
    typeof obj === 'object' &&
    'type' in obj &&
    'session_id' in obj &&
    ['system', 'user', 'assistant', 'tool_call', 'result'].includes(obj.type)
  );
}

/**
 * Normalize Cursor stream event to log entry
 */
export function normalizeCursorEvent(event: CursorStreamEvent): LogEntry | null {
  const timestamp = new Date().toISOString();
  const baseEntry = {
    id: `cursor-${event.session_id}-${Date.now()}`,
    timestamp,
  };

  switch (event.type) {
    case 'system': {
      const sysEvent = event as CursorSystemEvent;
      return {
        ...baseEntry,
        type: 'info' as LogEntryType,
        title: 'Session Started',
        content: `Model: ${sysEvent.model}\nAuth: ${sysEvent.apiKeySource}\nCWD: ${sysEvent.cwd}`,
        collapsed: true,
        metadata: {
          phase: 'init',
        },
      };
    }

    case 'assistant': {
      const assistEvent = event as CursorAssistantEvent;
      const text = assistEvent.message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');

      if (!text.trim()) return null;

      return {
        ...baseEntry,
        type: 'info' as LogEntryType,
        title: 'Assistant',
        content: text,
        collapsed: false,
      };
    }

    case 'tool_call': {
      const toolEvent = event as CursorToolCallEvent;
      return normalizeCursorToolCall(toolEvent, baseEntry);
    }

    case 'result': {
      const resultEvent = event as CursorResultEvent;

      if (resultEvent.is_error) {
        return {
          ...baseEntry,
          type: 'error' as LogEntryType,
          title: 'Error',
          content: resultEvent.error || resultEvent.result || 'Unknown error',
          collapsed: false,
        };
      }

      return {
        ...baseEntry,
        type: 'success' as LogEntryType,
        title: 'Completed',
        content: `Duration: ${resultEvent.duration_ms}ms`,
        collapsed: true,
      };
    }

    default:
      return null;
  }
}

/**
 * Normalize Cursor tool call event
 */
function normalizeCursorToolCall(
  event: CursorToolCallEvent,
  baseEntry: { id: string; timestamp: string }
): LogEntry | null {
  const toolCall = event.tool_call;
  const isStarted = event.subtype === 'started';
  const isCompleted = event.subtype === 'completed';

  // Read tool
  if (toolCall.readToolCall) {
    const path = toolCall.readToolCall.args.path;
    const result = toolCall.readToolCall.result?.success;

    return {
      ...baseEntry,
      id: `${baseEntry.id}-${event.call_id}`,
      type: 'tool_call' as LogEntryType,
      title: isStarted ? `Reading ${path}` : `Read ${path}`,
      content:
        isCompleted && result
          ? `${result.totalLines} lines, ${result.totalChars} chars`
          : `Path: ${path}`,
      collapsed: true,
      metadata: {
        toolName: 'Read',
        toolCategory: 'read' as ToolCategory,
        filePath: path,
        summary: isCompleted ? `Read ${result?.totalLines || 0} lines` : `Reading file...`,
      },
    };
  }

  // Write tool
  if (toolCall.writeToolCall) {
    const path =
      toolCall.writeToolCall.args?.path ||
      toolCall.writeToolCall.result?.success?.path ||
      'unknown';
    const result = toolCall.writeToolCall.result?.success;

    return {
      ...baseEntry,
      id: `${baseEntry.id}-${event.call_id}`,
      type: 'tool_call' as LogEntryType,
      title: isStarted ? `Writing ${path}` : `Wrote ${path}`,
      content:
        isCompleted && result
          ? `${result.linesCreated} lines, ${result.fileSize} bytes`
          : `Path: ${path}`,
      collapsed: true,
      metadata: {
        toolName: 'Write',
        toolCategory: 'write' as ToolCategory,
        filePath: path,
        summary: isCompleted ? `Wrote ${result?.linesCreated || 0} lines` : `Writing file...`,
      },
    };
  }

  // Generic function tool
  if (toolCall.function) {
    const name = toolCall.function.name;
    const args = toolCall.function.arguments;

    // Determine category based on tool name
    let category: ToolCategory = 'other';
    if (['Read', 'Glob'].includes(name)) category = 'read';
    if (['Write', 'Edit'].includes(name)) category = 'edit';
    if (['Bash'].includes(name)) category = 'bash';
    if (['Grep'].includes(name)) category = 'search';
    if (['TodoWrite'].includes(name)) category = 'todo';
    if (['Task'].includes(name)) category = 'task';

    return {
      ...baseEntry,
      id: `${baseEntry.id}-${event.call_id}`,
      type: 'tool_call' as LogEntryType,
      title: `${name} ${isStarted ? 'started' : 'completed'}`,
      content: args || '',
      collapsed: true,
      metadata: {
        toolName: name,
        toolCategory: category,
        summary: `${name} ${event.subtype}`,
      },
    };
  }

  return null;
}
```

### Task 5.2: Update parseLogLine Function

**Status:** `completed`

**File:** `apps/ui/src/lib/log-parser.ts`

Update the main parsing function to detect Cursor events:

```typescript
/**
 * Parse a single log line into a structured entry
 */
export function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;

  try {
    const parsed = JSON.parse(line);

    // Check if it's a Cursor stream event
    if (isCursorEvent(parsed)) {
      return normalizeCursorEvent(parsed);
    }

    // Existing AutoMaker/Claude event parsing...
    return parseAutoMakerEvent(parsed);
  } catch {
    // Non-JSON line - treat as plain text
    return {
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'info',
      title: 'Output',
      content: line,
      timestamp: new Date().toISOString(),
      collapsed: false,
    };
  }
}
```

### Task 5.3: Add Cursor-Specific Styling (Optional)

**Status:** `completed`

**File:** `apps/ui/src/lib/log-parser.ts`

Add provider-aware styling:

```typescript
/**
 * Get provider-specific styling for log entries
 */
export function getProviderStyle(entry: LogEntry): { badge?: string; icon?: string } {
  // Check if entry has Cursor session ID pattern
  if (entry.id.startsWith('cursor-')) {
    return {
      badge: 'Cursor',
      icon: 'terminal', // Or a Cursor-specific icon
    };
  }

  // Default (Claude)
  return {
    badge: 'Claude',
    icon: 'bot',
  };
}
```

---

## Verification

### Test 1: Cursor Event Parsing

```typescript
import { parseLogLine, normalizeCursorEvent } from './apps/ui/src/lib/log-parser';

// Test system init
const systemEvent =
  '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/project","session_id":"abc-123","model":"Claude 4 Sonnet","permissionMode":"default"}';
const systemEntry = parseLogLine(systemEvent);
console.assert(systemEntry?.type === 'info', 'System event should be info type');
console.assert(systemEntry?.title === 'Session Started', 'System should have correct title');

// Test assistant message
const assistantEvent =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello world"}]},"session_id":"abc-123"}';
const assistantEntry = parseLogLine(assistantEvent);
console.assert(assistantEntry?.content === 'Hello world', 'Assistant content should match');

// Test tool call
const toolEvent =
  '{"type":"tool_call","subtype":"started","call_id":"call-1","tool_call":{"readToolCall":{"args":{"path":"test.ts"}}},"session_id":"abc-123"}';
const toolEntry = parseLogLine(toolEvent);
console.assert(toolEntry?.metadata?.toolName === 'Read', 'Tool name should be Read');
console.assert(toolEntry?.metadata?.toolCategory === 'read', 'Category should be read');

console.log('All Cursor parsing tests passed!');
```

### Test 2: Mixed Event Stream

```typescript
// Simulate a stream with both Claude and Cursor events
const events = [
  // Cursor events
  '{"type":"system","subtype":"init","session_id":"cur-1","model":"GPT-4o","apiKeySource":"login","cwd":"/project","permissionMode":"default"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Reading file..."}]},"session_id":"cur-1"}',
  '{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"readToolCall":{"args":{"path":"README.md"}}},"session_id":"cur-1"}',
  // Claude-style event (existing format)
  '{"type":"assistant","content":[{"type":"text","text":"From Claude"}]}',
];

const entries = events.map(parseLogLine).filter(Boolean);
console.log('Parsed entries:', entries.length);
// Should parse all events correctly
```

### Test 3: Log Viewer Integration

1. Start the app with a Cursor provider task
2. Observe log viewer updates in real-time
3. Verify:
   - Tool calls show correct icons
   - File paths are highlighted
   - Collapsed by default where appropriate
   - Timestamps are displayed

---

## Verification Checklist

Before marking this phase complete:

- [x] `isCursorEvent()` correctly identifies Cursor events
- [x] `normalizeCursorEvent()` handles all event types
- [x] Tool calls are categorized correctly
- [x] File paths extracted for Read/Write tools
- [x] Existing Claude event parsing not broken
- [x] Log viewer displays Cursor events correctly
- [x] No runtime errors with malformed events

---

## Files Changed

| File                            | Action | Description                    |
| ------------------------------- | ------ | ------------------------------ |
| `apps/ui/src/lib/log-parser.ts` | Modify | Add Cursor event normalization |

---

## Notes

- Cursor events have `session_id` on all events (unlike Claude SDK)
- Tool call events come in pairs: started + completed
- The `call_id` is used to correlate started/completed events
- Entry IDs include session_id for uniqueness
