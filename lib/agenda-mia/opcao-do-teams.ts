/**
 * A opção "Microsoft Teams" do "Onde acontece", client-safe (zero import de
 * servidor): a tela de tipos é Client Component. FORK MIA (9015); o porquê
 * está em `lib/agenda-mia/tipos-com-teams.ts`.
 */
export const LOCAL_TEAMS = "microsoft_teams";
export const ROTULO_DO_TEAMS = "Microsoft Teams";
export const OPCAO_DO_TEAMS = { valor: LOCAL_TEAMS, rotulo: ROTULO_DO_TEAMS } as const;
