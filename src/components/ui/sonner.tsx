import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      theme="system"
      toastOptions={{
        duration: 5000,
        classNames: {
          toast:
            "group rounded-md border bg-background text-foreground shadow-lg",
          title: "text-sm font-semibold",
          description: "text-sm text-muted-foreground",
        },
      }}
    />
  );
}
