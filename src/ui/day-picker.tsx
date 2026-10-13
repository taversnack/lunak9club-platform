import s from './ui.module.css';
import { FieldError } from './form';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Weekday checkboxes for membership days (D86–D89). `name` defaults to `weekdays`. */
export function DayPicker({
  open,
  checked = [],
  name = 'weekdays',
  legend = 'Which days each week?',
}: {
  open: readonly number[];
  checked?: readonly number[];
  name?: string;
  legend?: string;
}) {
  return (
    <fieldset className={s.fieldset}>
      <legend className={s.label}>{legend}</legend>
      <FieldError name={name} />
      <div className={s.choices}>
        {DAYS.map((label, i) =>
          open.includes(i + 1) ? (
            <label key={label} className={s.choice}>
              <input type="checkbox" name={name} value={String(i + 1)} defaultChecked={checked.includes(i + 1)} />
              <span>{label}</span>
            </label>
          ) : null,
        )}
      </div>
    </fieldset>
  );
}

export const SESSION_OPTIONS = [
  { value: 'full', label: 'Full day' },
  { value: 'am', label: 'Morning' },
  { value: 'pm', label: 'Afternoon' },
];
