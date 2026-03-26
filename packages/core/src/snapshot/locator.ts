import { BridgeError } from '../shared/errors.js';
import type { LocatorSpec } from '../shared/types.js';

export interface NormalizedLocator {
  kind: 'css' | 'role' | 'text' | 'label' | 'testid' | 'object';
  value?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  testId?: string;
  nth: number;
}

export function normalizeLocator(locator: LocatorSpec): NormalizedLocator {
  if (typeof locator === 'string') {
    if (locator.startsWith('role=')) {
      return { kind: 'role', value: locator.slice(5), nth: 0 };
    }

    if (locator.startsWith('text=')) {
      return { kind: 'text', value: locator.slice(5), nth: 0 };
    }

    if (locator.startsWith('label=')) {
      return { kind: 'label', value: locator.slice(6), nth: 0 };
    }

    if (locator.startsWith('testid=')) {
      return { kind: 'testid', value: locator.slice(7), nth: 0 };
    }

    return { kind: 'css', value: locator, nth: 0 };
  }

  if (!locator.role && !locator.name && !locator.text && !locator.label && !locator.testId) {
    throw new BridgeError('INVALID_LOCATOR', 'Object-form locators must include at least one selector field.');
  }

  return {
    kind: 'object',
    role: locator.role,
    name: locator.name,
    text: locator.text,
    label: locator.label,
    testId: locator.testId,
    nth: locator.nth ?? 0,
  };
}

export function describeLocator(locator: LocatorSpec): string {
  const normalized = normalizeLocator(locator);

  switch (normalized.kind) {
    case 'css':
      return `css=${normalized.value ?? ''}`;
    case 'role':
      return `role=${normalized.value ?? ''}`;
    case 'text':
      return `text=${normalized.value ?? ''}`;
    case 'label':
      return `label=${normalized.value ?? ''}`;
    case 'testid':
      return `testid=${normalized.value ?? ''}`;
    case 'object': {
      const segments = [
        normalized.role ? `role=${normalized.role}` : null,
        normalized.name ? `name=${normalized.name}` : null,
        normalized.text ? `text=${normalized.text}` : null,
        normalized.label ? `label=${normalized.label}` : null,
        normalized.testId ? `testid=${normalized.testId}` : null,
        normalized.nth ? `nth=${normalized.nth}` : null,
      ].filter(Boolean);
      return segments.join(', ');
    }
  }
}

