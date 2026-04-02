import * as React from 'react';

import { cn } from '../../lib/utils.js';

const Progress = React.forwardRef(function Progress({ className, value = 0, indicatorClassName, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-surface-200', className)}
      {...props}
    >
      <div
        className={cn('h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-300 ease-out', indicatorClassName)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
});

export { Progress };
