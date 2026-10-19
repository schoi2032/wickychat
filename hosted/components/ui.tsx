import type { ButtonHTMLAttributes } from "react";

const icons = {
  home: <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" />,
  message: (
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H8l-5 2 1.6-5A8.5 8.5 0 1 1 21 11.5Z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5.7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="4" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="20" cy="12" r="1" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14a4 4 0 0 0 8 0M8 8h.01M16 8h.01" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 5-5 4 4 4-6 5 5" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="m11 13 11-11" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

export function IconButton({
  name,
  label,
  ...props
}: {
  name: IconName;
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={name} />
    </button>
  );
}

export function Avatar({
  initial,
  tone = "blue",
  small = false,
}: {
  initial: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${tone}${small ? " avatar-small" : ""}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
