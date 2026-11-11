import { ShieldCheck } from 'lucide-react';

const SIZE = {
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
} as const;

const PALETTE = [
  'bg-accent-600',
  'bg-teal-600',
  'bg-purple-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-600',
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function UserAvatar({
  name,
  size = 'md',
  admin = false,
}: {
  name: string;
  size?: keyof typeof SIZE;
  admin?: boolean;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`${SIZE[size]} ${colorFor(name)} rounded-full text-white font-semibold flex items-center justify-center`}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      {admin && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5 text-accent-600" title="Administrador">
          <ShieldCheck size={size === 'lg' ? 14 : 11} />
        </span>
      )}
    </span>
  );
}

export default UserAvatar;
