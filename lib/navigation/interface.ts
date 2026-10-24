/** Apresentação por vínculo. Nunca é autorização de página, API ou ação. */
import { z } from "zod";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";
import { NAV_CATALOG, type NavMetadata, type NavDestinationId } from "./catalogo";
import { moduloDaTela } from "@/lib/modulos/vendaveis";
import {
  mostraEmpresas,
  TELA_DE_EMPRESAS,
  type ModoDeVenda,
} from "@/lib/empresas/modo-de-venda";

const ids = NAV_CATALOG.map((d) => d.href);
/**
 * A preferência da ORGANIZAÇÃO, no mesmo jsonb que já existe (`interface_settings`).
 *
 * `compras_campos` é o recorte de "Últimas compras" (issue #3179): as CHAVES dos
 * campos personalizados do negócio que a empresa quer ver na linha da compra
 * (no caso de agência de viagens: destino, hospedagem, tipo de serviço). Lidas de
 * `crm_leads.custom_fields`; sem escolha salva, a seção mostra o padrão (data,
 * título, valor). Teto de 3 porque a linha do painel não cabe mais que isso.
 *
 * Nada de schema/tabela nova: é o MESMO campo que a interface da empresa já usa.
 */
export const interfaceSettingsSchema = z
  .object({
    preset: z.enum(["completa", "simplificada"]),
    destinos: z
      .array(z.enum(ids as [NavDestinationId, ...NavDestinationId[]]))
      .min(1)
      .max(ids.length)
      .transform((values) => ids.filter((id) => values.includes(id)))
      .optional(),
    compras_campos: z
      .array(z.string().min(1).max(40))
      .max(3)
      .transform((values) => [...new Set(values)])
      .optional(),
    /**
     * A caixa de mensagem do Inbox fica BLOQUEADA até o atendente assumir a
     * conversa (#3012).
     *
     * Mora aqui porque `interface_settings` é a preferência de ORGANIZAÇÃO que
     * já existe, atravessa a fronteira servidor/navegador pelo mesmo caminho do
     * menu (`ActiveOrg.interface_settings`) e é gravada pela mesma tela — sem
     * schema novo. Opcional e ausente = DESLIGADO: quem não liga não muda nada.
     *
     * É regra da ORGANIZAÇÃO, nunca do vínculo, e não é autorização: quem liga
     * só esconde a caixa até alguém assumir; papel, RLS e permissões seguem
     * decidindo o que cada pessoa alcança.
     */
    bloquearAteAssumir: z.boolean().optional(),
  })
  .strict();
export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
/** O teto de campos que o painel do contato mostra por compra (issue #3179). */
export const MAX_CAMPOS_DE_COMPRA = 3;
export const INTERFACE_COMPLETA: InterfaceSettings = { preset: "completa" };
const SIMPLIFICADA: readonly NavDestinationId[] = [
  "/app/inbox",
  "/app/agenda",
  "/app/kanban",
  "/app/contacts",
  "/app/tasks",
  "/app/connections",
];
/** Portas pessoais e recuperação administrativa não são removíveis. Atualização
 * e administração de plataforma têm consumidores próprios com seus gates atuais.
 *
 * `/app/settings/tenant` está aqui porque é a tela que HOSPEDA esta escolha. Sem
 * ela na lista, uma organização que a ocultasse se trancava do lado de fora: a
 * porta que desfaz a decisão desaparece junto com as outras, e não há caminho de
 * volta pela tela — só por banco. Quem administra tem de poder desfazer o que
 * escolheu, sempre.
 *
 * As QUATRO portas pessoais — Perfil, Segurança, Notificações e App no celular —
 * andam juntas (issue #3295). As duas últimas ficaram de fora e o resultado foi
 * que, na interface simplificada, quem mais precisa da preferência não achava a
 * tela: é em Notificações que a pessoa liga o lembrete de tarefa e informa o
 * próprio WhatsApp, e é em App no celular que se instala o sistema na tela de
 * início. São preferências de CADA UM — moram no `raw_user_meta_data` da própria
 * pessoa, e o administrador não configura por ela. Escondidas, não havia porta
 * nenhuma até elas: a tela só abria por URL digitada de memória. Nenhuma das
 * duas entra em `ESSENCIAIS_DE_ADMIN`: sendo pessoais, ficam visíveis para todo
 * vínculo em qualquer preset, como Perfil e Segurança.
 */
export const PORTAS_ESSENCIAIS = [
  "/app/settings/profile",
  "/app/settings/security",
  "/app/settings/notifications",
  "/app/settings/aplicativo",
  "/app/team",
  "/app/settings/tenant",
] as const;

/**
 * As essenciais que só valem para quem administra — as outras são pessoais e
 * valem para todo vínculo. `canSee` continua decidindo depois, pelo `minRole`:
 * estar aqui impede a organização de ESCONDER, nunca concede acesso a quem o
 * papel não dá.
 */
const ESSENCIAIS_DE_ADMIN: readonly string[] = ["/app/team", "/app/settings/tenant"];

export function essencial(d: NavMetadata, role: Role | null, platform = false): boolean {
  // Por PERTENCIMENTO à lista, nunca por índice: a versão anterior enumerava
  // `[0]`, `[1]` e `[2]`, então acrescentar uma quarta porta não teria efeito
  // nenhum e a lista passaria a mentir sobre o que ela garante.
  if (!(PORTAS_ESSENCIAIS as readonly string[]).includes(d.href)) return false;
  return ESSENCIAIS_DE_ADMIN.includes(d.href) ? platform || role === "admin" : true;
}
export function canSee(
  d: Pick<NavMetadata, "href" | "minRole" | "somentePlataforma">,
  platform: boolean,
  role: Role | null,
): boolean {
  // Destino de plataforma não tem papel de tenant que alcance: o admin do
  // cliente é o dono do negócio dele, não da operação da plataforma.
  if (d.somentePlataforma) return platform;
  return platform || (!!role && ROLE_RANK[role] >= ROLE_RANK[d.minRole ?? "viewer"]);
}
/**
 * `modulos` são os módulos opcionais LIGADOS na instalação. Ausente = não filtra
 * por módulo: quem desenha menu (sidebar, hub, ⌘K) passa a lista; quem só
 * pergunta "sobra alguma porta?" não precisa.
 */
export function permitidos(
  platform: boolean,
  role: Role | null,
  modulos?: readonly ModuloOpcional[],
  capacidades?: readonly CapacidadeDaOrganizacao[],
): NavMetadata[] {
  return (NAV_CATALOG as readonly NavMetadata[]).filter(
    (d) =>
      canSee(d, platform, role) &&
      // FORK MIA (.79, empresa única): Empresas (`/app/companies`) é o cadastro
      // ÚNICO de empresa do fork e existe sem o módulo `crm_b2b`; quem a
      // esconde é o modo de venda (B2C), em `destinosDaInterface`. Pessoas e
      // Importação seguem atrás do módulo. docs/fork/empresa-unica.md.
      (!modulos || !d.modulo || modulos.includes(d.modulo) || d.href === TELA_DE_EMPRESAS) &&
      (!capacidades || !d.capacidade || capacidades.includes(d.capacidade)),
  );
}
/** Leitura tolera versões antigas/removidas sem lançar no layout. */
export function lerInterface(raw: unknown): {
  settings: InterfaceSettings;
  needsAdjustment: boolean;
} {
  if (raw == null) return { settings: INTERFACE_COMPLETA, needsAdjustment: false };
  if (typeof raw !== "object") return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  const value = raw as Record<string, unknown>;
  const destinos = Array.isArray(value.destinos)
    ? ids.filter((id) => (value.destinos as unknown[]).includes(id))
    : undefined;
  const compras = Array.isArray(value.compras_campos)
    ? (value.compras_campos as unknown[]).filter((k): k is string => typeof k === "string")
    : undefined;
  const parsed = interfaceSettingsSchema.safeParse({
    preset: value.preset,
    ...(destinos ? { destinos } : {}),
    ...(compras ? { compras_campos: compras } : {}),
    // A regra do Inbox (#3012) é ESTRANHA ao menu, mas viaja no mesmo objeto:
    // sem esta linha `lerInterface` a descartaria e a organização que ligou a
    // opção a veria desligada depois de qualquer releitura.
    ...(value.bloquearAteAssumir === true ? { bloquearAteAssumir: true } : {}),
  });
  if (!parsed.success) return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  return {
    settings: parsed.data,
    needsAdjustment:
      (!!destinos && destinos.length !== (value.destinos as unknown[]).length) ||
      (!!compras && compras.length !== parsed.data.compras_campos?.length),
  };
}
/** As chaves de campo que a empresa escolheu mostrar em cada compra (#3179). */
export function camposDeCompraDaInterface(raw: unknown): string[] {
  return lerInterface(raw).settings.compras_campos ?? [];
}
export function destinosDaInterface(
  raw: unknown,
  platform: boolean,
  role: Role | null,
  /**
   * O que a organização CONTRATOU — os módulos VENDÁVEIS (lib/modulos/vendaveis.ts).
   * `undefined` = não se sabe, e aí nada é escondido: a rota é que recusa, e
   * sumir com a tela de quem pagou por não ter carregado uma lista seria trocar
   * um erro visível por um invisível.
   */
  modulos?: string[],
  /**
   * B2B ou B2C (item C2). `undefined` = não se sabe, e aí NADA some — mesma
   * regra dos módulos, pelo mesmo motivo: esconder por não ter carregado o
   * valor tiraria uma tela em uso, e "sumiu" é a mudança que o usuário não
   * reporta, ele só deixa de achar.
   *
   * ⚠️ Insumo de MENU, nunca de autorização: as rotas de `/api/v1/empresas`
   * continuam atendendo uma organização B2C que as chame. O modo esconde a
   * porta, não tranca — tratar preferência de tela como permissão é o que
   * transforma "não uso isso" em "perdi meus dados".
   */
  modoDeVenda?: ModoDeVenda,
  /**
   * Os módulos OPCIONAIS DA INSTALAÇÃO que estão ligados (lib/instalacao/
   * modulos.ts) — outra coisa, apesar do nome parecido com `modulos` acima.
   *
   * São dois eixos que NÃO podem virar um parâmetro só, e por isso viajam
   * separados até aqui: `modulos` é o que ESTA ORGANIZAÇÃO comprou (chave
   * `disparador`, por exemplo) e `modulosLigados` é o que O DONO DO SERVIDOR
   * habilitou para a instalação inteira (`banco_externo`). Fundir os dois numa
   * lista faria cada valor ser comparado contra o catálogo errado: nenhuma
   * chave bateria, e telas pagas sumiriam do menu sem ninguém ter desligado
   * nada — a falha silenciosa clássica.
   *
   * Aqui NÃO há escape para admin de plataforma (ao contrário dos dois filtros
   * abaixo): módulo desligado é recurso que não existe nesta instalação, e
   * mostrar a porta levaria a uma tela quebrada, não a uma tela de outro
   * cliente.
   */
  modulosLigados?: readonly ModuloOpcional[],
  /**
   * As CAPACIDADES que a ORGANIZAÇÃO ligou para si (lib/organizacao/
   * capacidades.ts, do upstream — hoje só `propostas`). Um quarto eixo, e de
   * novo NÃO é nenhum dos três acima: capacidade é chave que o administrador
   * da empresa liga nas configurações dela, já cruzada com o módulo da
   * instalação que ela exige.
   *
   * Vem por ÚLTIMO de propósito. No upstream ela é o 5º parâmetro, logo depois
   * de `modulos` (lá, os da instalação). Encaixá-la ali empurraria
   * `modoDeVenda` e `modulosLigados` uma casa para a direita, e toda chamada
   * nossa passaria a entregar cada lista no eixo vizinho — a mesma troca de
   * eixo que o comentário de `modulosLigados` descreve. No fim, quem não a
   * conhece continua certo, e quem a passar na posição do upstream cai em
   * `modoDeVenda`, que é outro tipo: o `tsc` recusa em vez de esconder telas
   * em silêncio.
   */
  capacidades?: readonly CapacidadeDaOrganizacao[],
): NavMetadata[] {
  const { settings } = lerInterface(raw);
  // Os LIGADOS na instalação, nunca os CONTRATADOS pela organização: é o
  // parâmetro que `permitidos` compara com `d.modulo` do catálogo. Passar a
  // lista errada aqui não daria erro em tempo de execução — só esconderia, em
  // silêncio, toda tela marcada com módulo de instalação.
  const allowed = permitidos(platform, role, modulosLigados, capacidades);
  const chosen =
    settings.destinos ?? (settings.preset === "simplificada" ? SIMPLIFICADA : undefined);
  /**
   * As DUAS origens de `chosen` não têm a mesma autoridade, e tratá-las igual
   * escondia a porta de todo módulo que a instalação ligasse depois.
   *
   * `destinos` é escolha de uma PESSOA, item por item, numa tela que listava
   * aquela porta — ela manda, inclusive sobre módulo ligado. Já `SIMPLIFICADA`
   * é lista do PRODUTO, escrita antes de existir módulo opcional: ela diz
   * "menu enxuto", nunca "esta empresa decidiu esconder Empresas". Quem
   * escolheu o preset num dia em que a porta não existia não decidiu nada
   * sobre ela, e ligar o módulo em Recursos opcionais não acendia nada —
   * módulo ligado no banco, invisível na tela, sem aviso em lugar nenhum.
   *
   * O CUSTO, declarado: o enxuto ganha UMA porta por módulo ligado — três no caso
   * do B2B, que tem três telas, e nenhuma nos dois módulos que não criam porta.
   * Módulo nasce desligado, então quem não liga nada não vê diferença. O número
   * exato não fica escrito aqui porque envelheceria a cada tela nova; para medir:
   * `destinosDaInterface({ preset: "simplificada" }, false, "admin", MODULOS_OPCIONAIS).length`
   * contra o mesmo com `[]`.
   *
   * `modulos` entra na condição de propósito: sem a lista (quem só pergunta
   * "sobra alguma porta?"), `permitidos` já deixou passar porta de módulo
   * DESLIGADO, e a exceção vazaria exatamente o que o gate existe para barrar.
   * O papel segue decidindo antes — isto é apresentação, nunca autorização.
   */
  // FORK MIA: no upstream a lista da INSTALAÇÃO se chama `modulos`; aqui ela é
  // `modulosLigados` (o `modulos` deste arquivo é o que a organização CONTRATOU).
  const deModuloLigado = (d: NavMetadata): boolean =>
    settings.destinos === undefined && !!d.modulo && !!modulosLigados && modulosLigados.includes(d.modulo);
  const contratados = modulos ? new Set(modulos) : null;
  const semEmpresas = modoDeVenda !== undefined && !mostraEmpresas(modoDeVenda);
  return allowed.filter((d) => {
    // Admin de plataforma continua vendo: é ele quem configura o modo, e
    // precisa achar a tela para conferir o que o cliente vê — a mesma regra
    // que os módulos já aplicam logo abaixo.
    if (semEmpresas && d.href === TELA_DE_EMPRESAS && !platform) return false;
    if (contratados) {
      const exigido = moduloDaTela(d.href);
      // Admin de plataforma enxerga tudo: é ele quem libera, e precisa achar a
      // tela para conferir o que o cliente vê.
      if (exigido && !contratados.has(exigido) && !platform) return false;
    }
    return (
      essencial(d, role, platform) ||
      deModuloLigado(d) ||
      !chosen ||
      chosen.includes(d.href as NavDestinationId)
    );
  });
}
export function interfaceTemDestino(
  settings: InterfaceSettings,
  role: Role,
  platform = false,
): boolean {
  return destinosDaInterface(settings, platform, role).some((d) => !essencial(d, role, platform));
}
export function homeDaInterface(raw: unknown, platform: boolean, role: Role | null): string {
  const visible = destinosDaInterface(raw, platform, role);
  return (
    visible.find((d) => d.href === "/app/inbox")?.href ??
    visible.find((d) => !essencial(d, role, platform))?.href ??
    "/app/settings/profile"
  );
}

/**
 * O conjunto de portas que uma escolha REALMENTE significa.
 *
 * `destinos` e `preset: simplificada` são duas formas de dizer a mesma coisa —
 * uma lista explícita e um punhado fixo. Tratar as duas como conjuntos é o que
 * permite combinar escolhas sem uma tabela de casos.
 */
function conjuntoEscolhido(s: InterfaceSettings): readonly NavDestinationId[] | undefined {
  return s.destinos ?? (s.preset === "simplificada" ? SIMPLIFICADA : undefined);
}

/** Portas essenciais que o catálogo conhece — o que sobra quando não há interseção. */
const SO_O_ESSENCIAL: readonly NavDestinationId[] = ids.filter((id) =>
  (PORTAS_ESSENCIAIS as readonly string[]).includes(id),
);

/**
 * As portas da EMPRESA ∩ as portas do VÍNCULO (migration 0367).
 *
 * A empresa escolhe o universo de portas da instalação; o vínculo escolhe menos
 * dentro dele — nunca mais. A ordem importa: quem administra a organização não
 * pode abrir para alguém uma porta que esse alguém já tinha dispensado, e quem
 * escolhe a própria interface não pode furar a escolha da empresa. Por isso a
 * combinação é INTERSEÇÃO nos dois eixos, e `simplificada` — que também é um
 * limite, não um enfeite — sobrevive vindo de qualquer um dos lados.
 *
 * Isto é APRESENTAÇÃO, como as duas entradas: o resultado alimenta sidebar, hub,
 * ⌘K e as telas. Autorização continua sendo `canSee` sobre o papel, aplicada
 * depois, sobre o conjunto já estreitado. Nenhuma escolha da empresa nega
 * página, API ou ação.
 *
 * E não abre por acidente: sem escolha de nenhum dos lados o resultado é a
 * interface completa e o papel decide. Com escolha de pelo menos um lado, o
 * resultado é sempre subconjunto — inclusive no caso sem interseção, onde
 * sobram só as portas essenciais. Devolver `destinos: []` seria recusado pelo
 * schema, e `lerInterface` converte valor recusado em interface COMPLETA: uma
 * falha ABERTA, exatamente o oposto do pretendido aqui.
 */
export function combinarInterfaces(daEmpresa: unknown, doVinculo: unknown): InterfaceSettings {
  const sEmpresa = lerInterface(daEmpresa).settings;
  const sVinculo = lerInterface(doVinculo).settings;
  /**
   * O BLOQUEIO ATÉ ASSUMIR (#3012) atravessa a combinação — e vem SEMPRE da
   * EMPRESA.
   *
   * É regra da ORGANIZAÇÃO: um vínculo não liga nem desliga a trava para si, e
   * a escolha por vínculo não a alcança. Sem esta carona, as QUATRO saídas
   * abaixo devolveriam `{ preset }` reconstruído do zero e a organização que
   * ligou a opção a encontraria desligada em `ActiveOrg.interface_settings` —
   * o mesmo descuido que a nota do preset logo abaixo descreve para a exceção
   * do módulo ligado.
   */
  const daOrganizacao: Pick<InterfaceSettings, "bloquearAteAssumir"> =
    sEmpresa.bloquearAteAssumir ? { bloquearAteAssumir: true } : {};
  const empresa = conjuntoEscolhido(sEmpresa);
  const vinculo = conjuntoEscolhido(sVinculo);
  /**
   * `compras_campos` (issue #3179) NÃO entra na interseção de portas: é a escolha
   * da EMPRESA sobre COMO desenhar a compra, não uma porta de menu que o vínculo
   * estreita. Ela só precisa ATRAVESSAR a combinação — sem isto, a leitura feita
   * pela interface combinada (`lib/auth/server.ts`) descartaria a escolha, que é
   * o mesmo estrago que o comentário do preset acima descreve.
   */
  const compras = sEmpresa.compras_campos ?? sVinculo.compras_campos;
  const comCompras = compras ? { compras_campos: compras } : {};
  if (!empresa && !vinculo) return { ...INTERFACE_COMPLETA, ...comCompras, ...daOrganizacao };

  /**
   * ⚠️ PRESET SOBREVIVE À COMBINAÇÃO, e sem isto a exceção da porta de módulo é CÓDIGO MORTO.
   *
   * `destinosDaInterface` distingue as duas origens de escolha: `destinos` é lista escrita por uma
   * PESSOA, item a item, e manda sobre tudo; `simplificada` é lista do PRODUTO, e não pode ser
   * lida como "esta empresa decidiu esconder Empresas". Mas esta função expandia o preset em
   * `destinos` antes de entregar — e aí as duas origens chegavam lá idênticas.
   *
   * Resultado medido: a exceção para porta de módulo LIGADO nunca disparava em produção
   * (`lib/auth/server.ts` chama esta função), e os casos que eu havia escrito passavam só porque
   * usavam a forma crua `{ preset: "simplificada" }`, que o produto nunca entrega. Um cético
   * achou, medindo as quatro combinações.
   *
   * Então: quando NENHUM dos lados escreveu lista à mão, o preset atravessa inteiro. Basta um lado
   * ter lista explícita para o resultado voltar a ser lista — aí existe decisão humana a respeitar.
   */
  const soPreset = sEmpresa.destinos === undefined && sVinculo.destinos === undefined;
  if (soPreset) return { preset: "simplificada", ...comCompras, ...daOrganizacao };

  const soUm = empresa ?? vinculo;
  if (!empresa || !vinculo) return { preset: "completa", destinos: [...(soUm as readonly NavDestinationId[])], ...comCompras, ...daOrganizacao };
  const comuns = empresa.filter((id) => vinculo.includes(id));
  return { preset: "completa", destinos: [...(comuns.length > 0 ? comuns : SO_O_ESSENCIAL)], ...comCompras, ...daOrganizacao };
}
