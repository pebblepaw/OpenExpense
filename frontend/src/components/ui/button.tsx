import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:brightness-110 active:scale-[.97]",
      destructive: "bg-destructive text-destructive-foreground hover:brightness-110",
      outline: "border border-border bg-background text-foreground hover:bg-accent",
      secondary: "bg-secondary text-secondary-foreground hover:brightness-105",
      ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
      link: "text-primary underline-offset-4 hover:underline",
      glass: "border border-border bg-surface/70 text-foreground shadow-soft backdrop-blur-xl hover:bg-accent",
      icon: "border border-border bg-surface/65 text-muted-foreground shadow-soft backdrop-blur-xl hover:bg-accent hover:text-foreground",
    },
    size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "size-9 p-0" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild, ...props }, ref) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
