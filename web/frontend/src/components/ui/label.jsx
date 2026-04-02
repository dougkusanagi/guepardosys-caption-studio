import * as React from 'react';

import { cn } from '../../lib/utils.js';

const Label = React.forwardRef(function Label({ className, ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn('text-xs font-semibold uppercase tracking-wider text-surface-500', className)}
      {...props}
    />
  );
});

export { Label };
