/**
 * Política de verificación en dos pasos (HU29, criterio 3). Sin dependencias
 * del servidor para poder probarla aislada.
 *
 * - El superadministrador siempre la tiene obligatoria.
 * - Una empresa puede exigirla a todas sus personas (company.requireTwoFactor).
 * - Las cuentas técnicas de estación (STATION, ADR 0007) quedan fuera: funcionan
 *   sin nadie delante y no pueden escribir un código.
 */
export type TwoFactorSubject = {
  role: string;
  twoFactorEnabled: boolean | null | undefined;
  company: { requireTwoFactor: boolean } | null | undefined;
};

export function isTwoFactorRequired(subject: Pick<TwoFactorSubject, "role" | "company">): boolean {
  if (subject.role === "SUPERADMIN") return true;
  if (subject.role === "STATION") return false;
  return subject.company?.requireTwoFactor === true;
}

/** La cuenta está obligada y todavía no la activó: solo puede entrar a configurarla. */
export function mustSetUpTwoFactor(subject: TwoFactorSubject): boolean {
  return isTwoFactorRequired(subject) && !subject.twoFactorEnabled;
}
