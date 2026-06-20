import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../../lib/utils.js';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef(function SheetOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-40 bg-black/35 backdrop-blur-sm', className)}
      {...props}
    />
  );
});

const sideClasses = {
  top: 'inset-x-0 top-0 border-b',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'left-0 top-0 bottom-0 w-80 border-r',
  right: 'right-0 top-0 bottom-0 w-80 border-l',
};

const SheetContent = React.forwardRef(function SheetContent(
  { side = 'right', className, children, showClose = true, hasOverlay = true, ...props },
  ref,
) {
  return (
    <SheetPortal>
      {hasOverlay && <SheetOverlay />}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-white shadow-2xl',
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700">
            <X className="h-4 w-4" />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});

function SheetHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />;
}

function SheetFooter({ className, ...props }) {
  return <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

const SheetTitle = React.forwardRef(function SheetTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold text-surface-900', className)} {...props} />;
});

const SheetDescription = React.forwardRef(function SheetDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-sm text-surface-500', className)} {...props} />;
});

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
