import Link from "next/link";
import { Logo } from "@/components/brand/logo";

type AuthShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

/** Marco común de las pantallas de cuenta: login y recuperación de contraseña. */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mx-auto mb-8 flex w-fit rounded-md text-lg" aria-label="RikuyDeep, ir al inicio">
          <Logo />
        </Link>
        <div className="rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="mt-2 leading-7 text-muted-foreground">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}
