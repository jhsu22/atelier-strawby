// A strawberry resting on two spines: the collection's mark.
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g className="brand-berry">
        <g transform="translate(24 1) scale(.66) translate(-24 0)">
          <path
            className="brand-berry-body"
            d="M24 45.5C14.6 41.6 6.5 32.6 6.5 22.4 6.5 16.6 10.4 13 15.8 13h16.4c5.4 0 9.3 3.6 9.3 9.4 0 10.2-8.1 19.2-17.5 23.1Z"
          />
          <g className="brand-berry-seeds">
            <ellipse cx="17" cy="23" rx="1.5" ry="2.3" />
            <ellipse cx="31" cy="23" rx="1.5" ry="2.3" />
            <ellipse cx="24" cy="32" rx="1.5" ry="2.3" />
          </g>
          <g className="brand-berry-crown" strokeLinejoin="round" strokeWidth="1.6">
            <path d="M24 16.5 12 15.2l5.6-3.4-2.4-5.6 8.8 4.2 8.8-4.2-2.4 5.6 5.6 3.4Z" />
            <path d="M24 10.4c.2-2.6 1-4.6 2.6-6.2" fill="none" strokeWidth="2.6" strokeLinecap="round" />
          </g>
        </g>
      </g>
      <rect className="brand-spine" x="9" y="34" width="30" height="5.5" rx="2.75" />
      <rect className="brand-spine" x="5" y="41.5" width="38" height="5.5" rx="2.75" />
    </svg>
  );
}

export function BrandLockup({ name }: { name: string }) {
  return (
    <a href="/" className="brand-lockup" aria-label={`${name} home`}>
      <BrandMark />
      <span className="brand-word">{name.toLowerCase()}</span>
    </a>
  );
}
