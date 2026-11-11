// StickyToolbar — keeps search/filter controls pinned to the top of the
// scrolling content area instead of scrolling away with the list.
//
// AppShell's <main> is the scroll container and carries the page gutter
// (p-6). Chromium pins sticky children at the container's CONTENT-box top,
// so the band compensates in both axes: -mx-6/-top-6 pull it over the
// gutter so rows scrolling under it are covered flush to the visible edge,
// and px-6/py-3 restore the inner spacing.

import React from 'react';

export interface StickyToolbarProps {
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function StickyToolbar({
  children,
  className = '',
  'data-testid': testId,
}: StickyToolbarProps) {
  return (
    <div
      data-testid={testId}
      className={[
        'sticky -top-6 z-20 -mx-6 px-6 py-3 mb-4',
        'bg-brand-50 border-b border-brand-100',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export default StickyToolbar;
