import { describe, expect, it } from 'vitest';
import { bookPageState } from '@/domain/booking/book-page';

const dog = (canBook: boolean, canRequestTrial: boolean) => ({ canBook, canRequestTrial });

describe('Book page state', () => {
  it('asks the customer to add a dog when they have none', () => {
    expect(bookPageState([])).toBe('no-dogs');
  });
  it('shows the form (with the trial option) when the only dogs need a trial day (D85)', () => {
    expect(bookPageState([dog(false, true)])).toBe('form');
    expect(bookPageState([dog(false, true), dog(false, false)])).toBe('form');
  });
  it('shows the form when any dog can book', () => {
    expect(bookPageState([dog(true, false), dog(false, false)])).toBe('form');
  });
  it('says there is nothing to book when no dog can book or ask for a trial', () => {
    expect(bookPageState([dog(false, false)])).toBe('nothing-to-book');
  });
});
