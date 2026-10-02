import type * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../utils";
import "./popover.css";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = ({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>) => (
  <PopoverPrimitive.Portal>
    <div className="popover-portal">
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("popover-content", className)}
        {...props}
      />
    </div>
  </PopoverPrimitive.Portal>
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverContent, PopoverTrigger };
