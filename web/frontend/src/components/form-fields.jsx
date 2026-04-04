import { Label } from './ui/label.jsx';
import { Input } from './ui/input.jsx';

export function SelectField({ label, value, onChange, children }) {
  const items = Array.isArray(children) ? children : [children];

  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 appearance-none cursor-pointer"
      >
        {items.map((child, index) => (
          <option key={`${child.props.value ?? child.props.children}-${index}`} value={String(child.props.value)}>
            {child.props.children}
          </option>
        ))}
      </select>
    </div>
  );
}

export function InputField({ label, onChange, ...props }) {
  return (
    <div>
      <Label className="mb-1 block normal-case tracking-normal font-medium text-surface-500">{label}</Label>
      <Input
        {...props}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
    </div>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <div>
      <Label className="mb-1 block normal-case tracking-normal font-medium text-surface-500">{label}</Label>
      <Input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 cursor-pointer p-1" />
    </div>
  );
}
