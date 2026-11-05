import { Comparison } from "@/components/landing/comparison";
import { DemoSection } from "@/components/landing/demo-section";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Plans } from "@/components/landing/plans";
import { Problem } from "@/components/landing/problem";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { Solution } from "@/components/landing/solution";

export default function Home() {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido" className="flex-1">
        <Hero />
        <Problem />
        <Solution />
        <HowItWorks />
        <Comparison />
        <Plans />
        <DemoSection />
      </main>
      <SiteFooter />
    </>
  );
}
