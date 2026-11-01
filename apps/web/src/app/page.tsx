import { Logo } from "@/components/brand/logo";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-24">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        <h1 className="text-4xl">
          <Logo />
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Inspección visual de calidad con inteligencia artificial, directamente en el navegador.
        </p>
        <p className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm text-muted-foreground">
          Aplicación web en construcción
        </p>
      </div>
    </main>
  );
}
