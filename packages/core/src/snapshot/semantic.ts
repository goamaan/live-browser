import type { SnapshotNode, SnapshotResult } from '../shared/types.js';

interface RawSnapshotNode {
  id: string;
  parentId: string | null;
  role: string;
  name: string;
  text: string;
  locators: string[];
  box: SnapshotNode['box'];
  visible: boolean;
  disabled: boolean;
  framePath: string[];
}

interface RawSnapshotPayload {
  url: string;
  title: string;
  nodes: RawSnapshotNode[];
}

export function snapshotExpression(): string {
  return `(() => {
    const roleMap = new Map([
      ['A', 'link'],
      ['BUTTON', 'button'],
      ['INPUT', 'textbox'],
      ['SELECT', 'combobox'],
      ['TEXTAREA', 'textbox'],
      ['IMG', 'img'],
      ['UL', 'list'],
      ['OL', 'list'],
      ['LI', 'listitem'],
      ['TABLE', 'table'],
      ['TR', 'row'],
      ['TD', 'cell'],
      ['TH', 'columnheader'],
      ['H1', 'heading'],
      ['H2', 'heading'],
      ['H3', 'heading'],
      ['H4', 'heading'],
      ['H5', 'heading'],
      ['H6', 'heading']
    ]);

    const normalized = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const implicitRole = (el) => {
      const tag = el.tagName.toUpperCase();
      if (tag === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      return roleMap.get(tag) || '';
    };

    const cssPath = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        let part = tag;
        if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += ':nth-of-type(' + index + ')';
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };

    const accessibleName = (el) => {
      const aria = normalized(el.getAttribute('aria-label'));
      if (aria) return aria;

      const labelledBy = normalized(el.getAttribute('aria-labelledby'));
      if (labelledBy) {
        const parts = labelledBy.split(' ').map((id) => normalized(document.getElementById(id)?.textContent)).filter(Boolean);
        if (parts.length > 0) return parts.join(' ');
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const labels = Array.from(document.querySelectorAll('label')).filter((label) => {
          const htmlFor = label.getAttribute('for');
          return (htmlFor && htmlFor === el.id) || label.contains(el);
        });
        const labelText = normalized(labels.map((label) => label.textContent).join(' '));
        if (labelText) return labelText;
      }

      const text = normalized(el.textContent);
      if (text) return text.slice(0, 120);
      return '';
    };

    const candidateLocators = (el, role, name, text) => {
      const locators = [];
      const testId = normalized(el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
      if (testId) locators.push('testid=' + testId);
      if (role && name) locators.push('role=' + role + '|' + name);
      if (name) locators.push('label=' + name);
      if (text && text.length < 80) locators.push('text=' + text);
      locators.push(cssPath(el));
      return Array.from(new Set(locators));
    };

    const nodes = [];
    const walk = (root, parentId, framePath) => {
      if (!(root instanceof Element)) return;
      const nodeId = cssPath(root) + '::' + Array.from(root.parentElement?.children || []).indexOf(root);
      const role = normalized(root.getAttribute('role')) || implicitRole(root);
      const name = accessibleName(root);
      const text = normalized(root.textContent).slice(0, 160);
      const isVisible = visible(root);
      const rect = root.getBoundingClientRect();
      const hasInterestingState = role || name || text || root.hasAttribute('data-testid') || root.hasAttribute('aria-label');
      if (hasInterestingState) {
        nodes.push({
          id: nodeId,
          parentId,
          role,
          name,
          text,
          locators: candidateLocators(root, role, name, text),
          box: isVisible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          visible: isVisible,
          disabled: root.hasAttribute('disabled') || root.getAttribute('aria-disabled') === 'true',
          framePath
        });
      }

      for (const child of Array.from(root.children)) {
        walk(child, nodeId, framePath);
      }

      if (root.shadowRoot) {
        for (const child of Array.from(root.shadowRoot.children)) {
          walk(child, nodeId, framePath.concat('#shadow-root'));
        }
      }

      if (root instanceof HTMLIFrameElement) {
        try {
          const doc = root.contentDocument;
          if (doc?.documentElement) {
            walk(doc.documentElement, nodeId, framePath.concat(cssPath(root)));
          }
        } catch {
          // Cross-origin iframes are intentionally skipped in the DOM walk.
        }
      }
    };

    walk(document.documentElement, null, []);
    return {
      url: location.href,
      title: document.title,
      nodes
    };
  })()`;
}

export function buildSnapshotTree(payload: RawSnapshotPayload): SnapshotResult['nodes'] {
  const map = new Map<string, SnapshotNode>();
  const roots: SnapshotNode[] = [];

  for (const rawNode of payload.nodes) {
    map.set(rawNode.id, {
      id: rawNode.id,
      role: rawNode.role,
      name: rawNode.name,
      text: rawNode.text,
      locators: rawNode.locators,
      box: rawNode.box,
      visible: rawNode.visible,
      disabled: rawNode.disabled,
      framePath: rawNode.framePath,
      children: [],
    });
  }

  for (const rawNode of payload.nodes) {
    const current = map.get(rawNode.id);
    if (!current) {
      continue;
    }

    if (rawNode.parentId && map.has(rawNode.parentId)) {
      map.get(rawNode.parentId)?.children.push(current);
      continue;
    }

    roots.push(current);
  }

  return roots;
}

export function diffSnapshotTrees(previous: SnapshotNode[] | undefined, current: SnapshotNode[]): Pick<SnapshotResult, 'added' | 'removed' | 'changed'> {
  if (!previous) {
    return {
      added: current.map((node) => node.id),
      removed: [],
      changed: [],
    };
  }

  const flatten = (nodes: SnapshotNode[]): Map<string, SnapshotNode> => {
    const map = new Map<string, SnapshotNode>();
    const stack = [...nodes];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      map.set(node.id, node);
      stack.push(...node.children);
    }
    return map;
  };

  const before = flatten(previous);
  const after = flatten(current);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, node] of after) {
    const prior = before.get(id);
    if (!prior) {
      added.push(id);
      continue;
    }

    if (
      prior.role !== node.role ||
      prior.name !== node.name ||
      prior.text !== node.text ||
      prior.visible !== node.visible ||
      prior.disabled !== node.disabled
    ) {
      changed.push(id);
    }
  }

  for (const id of before.keys()) {
    if (!after.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed, changed };
}

