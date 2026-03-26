import { describe, expect, it } from 'vitest';
import { BridgeError } from '../src/shared/errors.js';
import { describeLocator, normalizeLocator } from '../src/snapshot/locator.js';

describe('normalizeLocator', () => {
  it('normalizes string shorthand locators', () => {
    expect(normalizeLocator('role=button|Save')).toEqual({
      kind: 'role',
      value: 'button|Save',
      nth: 0,
    });

    expect(normalizeLocator('text=Queued')).toEqual({
      kind: 'text',
      value: 'Queued',
      nth: 0,
    });

    expect(normalizeLocator('label=Name')).toEqual({
      kind: 'label',
      value: 'Name',
      nth: 0,
    });

    expect(normalizeLocator('testid=status')).toEqual({
      kind: 'testid',
      value: 'status',
      nth: 0,
    });

    expect(normalizeLocator('.toolbar button')).toEqual({
      kind: 'css',
      value: '.toolbar button',
      nth: 0,
    });
  });

  it('normalizes object locators and preserves nth', () => {
    expect(
      normalizeLocator({
        role: 'button',
        name: 'Save',
        testId: 'primary-save',
        nth: 2,
      }),
    ).toEqual({
      kind: 'object',
      role: 'button',
      name: 'Save',
      text: undefined,
      label: undefined,
      testId: 'primary-save',
      nth: 2,
    });
  });

  it('rejects empty object locators', () => {
    expect(() => normalizeLocator({})).toThrowError(BridgeError);
    expect(() => normalizeLocator({})).toThrow('Object-form locators must include at least one selector field.');
  });
});

describe('describeLocator', () => {
  it('describes css and object locators consistently', () => {
    expect(describeLocator('.status-pill')).toBe('css=.status-pill');
    expect(
      describeLocator({
        role: 'button',
        name: 'Save',
        text: 'Save',
        nth: 1,
      }),
    ).toBe('role=button, name=Save, text=Save, nth=1');
  });
});
