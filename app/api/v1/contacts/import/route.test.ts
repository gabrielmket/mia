// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { hashCpf } from "@/lib/contacts/cpf";
import { requireSupportWrite } from "@/lib/impersonate/support";
import type { PerfilDoPais } from "@/lib/legal/perfil-do-pais";
import { PERFIS_DO_PAIS } from "@/lib/legal/perfil-do-pais";
import { createClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const PHONE = "+5511999998888";

interface Resumo {
  total_linhas: number;
  imported: number;
  skipped_duplicates: number;
  errors: Array<{ linha: number; motivo: string }>;
  // FORK MIA (.97)
  telefones_completados: number;
  emails_completados: number;
  sem_telefone: number;
  sem_coluna_de_telefone: boolean;
  colunas_ignoradas: string[];
  avisos: Array<{ linha: number; motivo: string }>;
}

/** FORK MIA (.97): o contato que o dublê devolve da leitura de quem já existe. */
interface Existente {
  id?: string;
  phone_number?: string | null;
  email_normalized?: string | null;
  is_anonymized?: boolean;
}

/** Só as fronteiras externas são dubladas; multipart, CSV e schemas são reais. */
function banco(opcoes: {
  existentes?: Existente[];
  /** FORK MIA (.97): a leitura de quem já existe falha. */
  leituraFalha?: boolean;
  /** FORK MIA (.97): a gravação do que faltava é recusada. */
  falhaAoCompletar?: { code: string; message: string };
  falhas?: Array<{ code: string; message: string } | null>;
  /** O país declarado pela organização; ausente/`null` é o Brasil. */
  pais?: string | null;
  /** A RPC `encrypt_cpf` não responde — banco sem a migration 0597 ou sem a chave. */
  cifraIndisponivel?: boolean;
} = {}) {
  const tentativas: Record<string, unknown>[] = [];
  const completados: Array<{ id: unknown; campos: Record<string, unknown> }> = [];
  const lotesLidos: string[][] = [];
  // `encrypt_cpf` (migration 0597) devolve o ciphertext; sem ele,
  // `camposCpfParaGravar` grava a linha SEM CPF. `cifraIndisponivel` encena o
  // banco em que a RPC ainda não existe ou a chave não foi semeada (#2522).
  const rpc = vi.fn(async (nome: string) => {
    if (nome !== "encrypt_cpf") return { error: null };
    if (opcoes.cifraIndisponivel) return { error: { message: "encrypt_cpf RPC unavailable" } };
    return { data: new Uint8Array([1, 2, 3]), error: null };
  });
  const from = vi.fn((tabela: string) => {
    // A régua do documento vem do PAÍS da organização (issue #1033): a rota lê a
    // organização UMA vez, na entrada. O dublê libera só essa leitura e segue
    // fechando a porta para qualquer outra tabela.
    if (tabela === "organizations") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: { country: opcoes.pais ?? null }, error: null })),
      };
    }
    expect(tabela).toBe("contacts");
    let mudanca: Record<string, unknown> | null = null;
    let alvo: unknown = null;
    const consulta = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((coluna: string, valor: unknown) => {
        if (coluna === "id") alvo = valor;
        return consulta;
      }),
      not: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn(async (coluna: "phone_number" | "email_normalized", valores: string[]) => {
        expect(consulta.eq).toHaveBeenCalledWith("organization_id", ORG);
        expect(consulta.is).toHaveBeenCalledWith("is_merged_into", null);
        lotesLidos.push(valores);
        if (opcoes.leituraFalha) return { data: null, error: { message: "fetch failed" } };
        return {
          data: (opcoes.existentes ?? []).filter((r) => valores.includes(r[coluna] ?? "")),
          error: null,
        };
      }),
      update: vi.fn((linha: Record<string, unknown>) => {
        mudanca = linha;
        return consulta;
      }),
      maybeSingle: vi.fn(async () => {
        if (opcoes.falhaAoCompletar) return { data: null, error: opcoes.falhaAoCompletar };
        const { updated_at: _quando, ...campos } = mudanca ?? {};
        completados.push({ id: alvo, campos });
        const antes = (opcoes.existentes ?? []).find((r) => r.id === alvo);
        return {
          data: {
            ...antes,
            ...campos,
            email_normalized:
              typeof campos.email === "string" ? campos.email.toLowerCase() : (antes?.email_normalized ?? null),
          },
          error: null,
        };
      }),
      insert: vi.fn((linha: Record<string, unknown>) => {
        tentativas.push(linha);
        return consulta;
      }),
      single: vi.fn(async () => ({
        data: { id: `contato-${tentativas.length}` },
        error: opcoes.falhas?.[tentativas.length - 1] ?? null,
      })),
    };
    return consulta;
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { tentativas, rpc, completados, lotesLidos };
}

async function importar(linhas: string[], cabecalho = "nome,telefone,email"): Promise<Resumo> {
  const form = new FormData();
  form.set("file", new File(
    [[cabecalho, ...linhas].join("\n")],
    "contatos.csv",
    { type: "text/csv" },
  ));
  const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
    method: "POST",
    body: form,
  }));
  expect(resposta.status).toBe(200);
  const { data } = await resposta.json() as { data: Resumo };
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER,
      email: "operador@example.com",
      full_name: "Operador",
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [{ organization_id: ORG, organization_name: "Org", role: "agent" }],
    },
    org: { orgId: ORG, name: "Org", role: "agent" },
  });
});

describe("POST /api/v1/contacts/import — desfecho por linha", () => {
  it.each([
    { caso: "telefone", linhas: [`Ana,${PHONE},`, `Ana,${PHONE},`, `Ana,${PHONE},`] },
    { caso: "e-mail sem telefone e sem distinguir maiúsculas", linhas: [
      "Ana,,ana@example.com", "Ana,,ANA@example.com", "Ana,,ana@example.com",
    ] },
    { caso: "e-mail compartilhado por telefones diferentes", linhas: [
      `Ana,${PHONE},ana@example.com`, "Ana,+5521999998888,ana@example.com", "Ana,,ana@example.com",
    ] },
  ])("contabiliza todas as repetições por $caso sem repetir insert/evento", async ({ linhas }) => {
    const db = banco();
    const resumo = await importar(linhas);

    expect(resumo).toMatchObject({ total_linhas: 3, imported: 1, skipped_duplicates: 2, errors: [] });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({
      organization_id: ORG, created_by_user_id: USER, source: "import_csv",
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("emit_event", expect.objectContaining({
      p_event_type: "contact.created", p_entity_id: "contato-1", p_organization_id: ORG,
    }));
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "contacts.imported",
      organizationId: ORG,
      metadata: expect.objectContaining({ actor_type: "user", total_linhas: 3, imported: 1, skipped_duplicates: 2, erros: 0 }),
    }));
  });

  it("uma linha rejeitada pelo schema não impede a próxima com o mesmo telefone", async () => {
    const db = banco();
    const resumo = await importar([
      `Inválida,${PHONE},ana..silva@example.com`,
      `Corrigida,${PHONE},ana.silva@example.com`,
    ]);

    expect(resumo).toMatchObject({
      total_linhas: 2, imported: 1, skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: expect.any(String) }],
    });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({ name: "Corrigida", email: "ana.silva@example.com" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("continua após erro de gravação sem reservar o telefone da linha que falhou", async () => {
    const db = banco({ falhas: [{ code: "23514", message: "Falha de gravação" }, null] });
    const resumo = await importar([`Primeira,${PHONE},`, `Segunda,${PHONE},`]);

    expect(resumo).toMatchObject({
      total_linhas: 2, imported: 1, skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: "Falha de gravação" }],
    });
    expect(db.tentativas).toHaveLength(2);
    expect(db.tentativas[1]).toMatchObject({ name: "Segunda", phone_number: PHONE });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("emit_event", expect.objectContaining({
      p_entity_id: "contato-2",
    }));
  });

  it("pular e-mail existente não reserva um telefone que ainda não foi importado", async () => {
    // FORK MIA (.97): o contato do e-mail já tem OUTRO telefone. Sem nenhum, a
    // linha agora completa o dele (caso próprio, no fim deste arquivo).
    const db = banco({
      existentes: [{ id: "c-1", email_normalized: "existente@example.com", phone_number: "+5531999990000" }],
    });
    const resumo = await importar([
      `Existente,${PHONE},existente@example.com`,
      `Nova,${PHONE},nova@example.com`,
    ]);

    expect(resumo).toMatchObject({ total_linhas: 2, imported: 1, skipped_duplicates: 1, errors: [] });
    expect(db.tentativas).toHaveLength(1);
    expect(db.tentativas[0]).toMatchObject({ name: "Nova", email: "nova@example.com" });
  });

  it("conta cada linha que repete um contato já presente no banco", async () => {
    const db = banco({ existentes: [{ phone_number: PHONE }] });
    const resumo = await importar([`Ana,${PHONE},`, `Ana,${PHONE},`]);

    expect(resumo).toMatchObject({ total_linhas: 2, imported: 0, skipped_duplicates: 2, errors: [] });
    expect(db.tentativas).toHaveLength(0);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("mantém o conflito de índice único como duplicado sem bloquear a próxima linha", async () => {
    const db = banco({ falhas: [{ code: "23505", message: "Conflito" }, null] });
    const resumo = await importar([`Ana,${PHONE},`, "Bia,+5521999998888,"]);

    expect(resumo).toMatchObject({ total_linhas: 2, imported: 1, skipped_duplicates: 1, errors: [] });
    expect(db.tentativas).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/contacts/import — a planilha segue o PAÍS da organização (issue #1033)", () => {
  /**
   * País sintético, e não um país de verdade: a issue #1033 proíbe publicar
   * citação de lei não revisada, e o registro é mutável justamente para o teste
   * provar o mecanismo sem publicar nada. Nada aqui é oferecido ao operador
   * (`paisesOferecidos` exige `revisada`), que é o ponto.
   */
  const PERFIL_DO_XISTAO: PerfilDoPais = {
    codigo: "XI",
    nome: "Xistão",
    // País sintético declara os SEUS rótulos de organização (#1946, item 4).
    empresa: { rotuloNomeLegal: "Razão do Xistão", rotuloNumero: "Registro do Xistão" },
    // País sintético declara os SEUS papéis legais (#2344).
    papel: { controlador: "Controlador do Xistão", encarregado: "Encarregado do Xistão" },
    telefoneExemplo: "+999000000000",
    documento: {
      rotulo: "Bilhete",
      exemplo: "123456789XI000",
      regra: "forma — 9 dígitos, 2 letras e 3 dígitos; não confere dígito verificador",
      mensagemInvalido: "Bilhete inválido",
      confereDigito: false,
      apelidosDoCabecalho: ["bilhete"],
      valida: (valor) => /^\d{9}[A-Z]{2}\d{3}$/.test(valor),
      normaliza: (valor) => valor.toUpperCase().replace(/[^0-9A-Z]/g, ""),
    },
    idioma: "xi-XI",
    fusoDoSugerido: "UTC",
    lei: { nome: "Lei do Xistão", numero: "Lei nº 1/2020", artigo: "Art. 5º", revisada: false },
    calendario: { feriados: [], rotulo: "feriados do Xistão" },
    padroesDePii: [],
  };

  beforeEach(() => {
    PERFIS_DO_PAIS.XI = PERFIL_DO_XISTAO;
  });

  afterEach(() => {
    delete PERFIS_DO_PAIS.XI;
  });

  async function importarCom(cabecalho: string, linhas: string[]) {
    const form = new FormData();
    form.set("file", new File(
      [[cabecalho, ...linhas].join("\n")],
      "contatos.csv",
      { type: "text/csv" },
    ));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
      method: "POST",
      body: form,
    }));
    return { status: resposta.status, corpo: await resposta.json() as { data?: Resumo } };
  }

  it("aceita o cabeçalho do documento do país e grava o valor como o país normaliza", async () => {
    const db = banco({ pais: "XI" });
    const { status, corpo } = await importarCom("nome,telefone,bilhete", [`Ana,${PHONE},123456789xi000`]);

    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [] });
    // O documento não é gravado em claro: o que prova o valor (e a normalização
    // do país) é o hash — `hashCpf("123456789XI000")`, com o valor já em
    // maiúsculas e sem o que não é dígito nem letra.
    expect(db.tentativas[0]).toMatchObject({ cpf_hash: hashCpf("123456789XI000") });
    expect(db.rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({
      p_payload: expect.objectContaining({ has_cpf: true }),
    }));
  });

  it("diz na mensagem a régua do país — sem prometer dígito verificado que não existe", async () => {
    const db = banco({ pais: "XI" });
    const { corpo } = await importarCom("nome,telefone,bilhete", [`Ana,${PHONE},123`]);

    expect(corpo.data).toMatchObject({
      total_linhas: 1,
      imported: 0,
      skipped_duplicates: 0,
      errors: [{ linha: 2, motivo: expect.stringContaining("Bilhete inválido") }],
    });
    expect(corpo.data?.errors[0]?.motivo).not.toContain("CPF");
    expect(db.tentativas).toHaveLength(0);
  });

  it("sem país declarado nada muda para quem já usa: o Brasil de sempre", async () => {
    const db = banco();
    const { corpo } = await importarCom("nome,telefone,cpf", [`Ana,${PHONE},111.111.111-11`]);

    expect(corpo.data?.errors[0]?.motivo).toContain("CPF inválido");
    expect(db.tentativas).toHaveLength(0);
  });
});

describe("POST /api/v1/contacts/import — o CPF grava os DOIS campos ou nenhum (#2522)", () => {
  /** CPF do próprio exemplo da issue: dígitos verificadores válidos. */
  const CPF = "529.982.247-25";

  async function importarCpf(linhas: string[]) {
    const form = new FormData();
    form.set("file", new File(
      [["nome,telefone,cpf", ...linhas].join("\n")],
      "contatos.csv",
      { type: "text/csv" },
    ));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", {
      method: "POST",
      body: form,
    }));
    return { status: resposta.status, corpo: await resposta.json() as { data?: Resumo } };
  }

  it("com a RPC no schema a linha nasce com hash E ciphertext", async () => {
    const db = banco();
    const { status, corpo } = await importarCpf([`Ana,${PHONE},${CPF}`]);

    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [] });
    expect(db.tentativas[0]).toMatchObject({
      cpf_hash: hashCpf(CPF),
      cpf_encrypted: expect.anything(),
    });
  });

  it("sem cifra disponível a linha é salva SEM CPF — nunca cpf_hash sozinho (#2522)", async () => {
    const db = banco({ cifraIndisponivel: true });
    const { status, corpo } = await importarCpf([`Ana,${PHONE},${CPF}`]);

    // O defeito reportado: a linha voltava em `errors` com
    // `violates check constraint "contacts_cpf_consistency"`. Agora ela entra.
    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({ total_linhas: 1, imported: 1, skipped_duplicates: 0, errors: [] });
    // Os DOIS ausentes: é a paridade que o CHECK cobra.
    expect(db.tentativas[0]).not.toHaveProperty("cpf_hash");
    expect(db.tentativas[0]).not.toHaveProperty("cpf_encrypted");
  });
});

/**
 * FORK MIA (.97) — o defeito vivido em produção em 29/10/2026 e a reimportação
 * que o conserta. Telefones e e-mails fictícios.
 */
describe("POST /api/v1/contacts/import — a planilha name,phone,email", () => {
  const CABECALHO = "name,phone,email";

  it("grava telefone e e-mail, e a linha só com telefone entra", async () => {
    const db = banco();
    const resumo = await importar(
      [
        "Ana,+5511900000001,ana@example.invalid",
        'Bia,+55 (31) 900000002,',
        "Caio,,caio@example.invalid",
      ],
      CABECALHO,
    );

    expect(resumo).toMatchObject({
      total_linhas: 3,
      imported: 3,
      errors: [],
      sem_telefone: 1,
      sem_coluna_de_telefone: false,
      colunas_ignoradas: [],
    });
    expect(db.tentativas.map((t) => t.phone_number)).toEqual(["+5511900000001", "+5531900000002", null]);
    expect(db.tentativas.map((t) => t.email)).toEqual(["ana@example.invalid", null, "caio@example.invalid"]);
  });

  it("reimportar completa o telefone de quem já existe pelo e-mail, sem duplicar", async () => {
    const db = banco({ existentes: [{ id: "c-1", email_normalized: "ana@example.invalid", phone_number: null }] });
    const resumo = await importar(["Ana,+5511900000001,ANA@example.invalid"], CABECALHO);

    expect(resumo).toMatchObject({ imported: 0, skipped_duplicates: 0, telefones_completados: 1, errors: [] });
    expect(db.tentativas).toHaveLength(0);
    expect(db.completados).toEqual([{ id: "c-1", campos: { phone_number: "+5511900000001" } }]);
    // Auditoria L-06 do contato, e sem o evento que dispara automação.
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.updated",
        resourceId: "c-1",
        metadata: expect.objectContaining({ old_phone_number: null, new_phone_number: "+5511900000001" }),
      }),
    );
    const eventos = (db.rpc.mock.calls as unknown as Array<[string, { p_event_type: string }]>).map((c) => c[1].p_event_type);
    expect(eventos).toEqual(["contact.updated"]);
  });

  it("reimportar a mesma planilha duas vezes na mesma leitura conta a segunda como repetida", async () => {
    const db = banco({ existentes: [{ id: "c-1", email_normalized: "ana@example.invalid", phone_number: null }] });
    const resumo = await importar(
      ["Ana,+5511900000001,ana@example.invalid", "Ana,+5511900000001,ana@example.invalid"],
      CABECALHO,
    );

    expect(resumo).toMatchObject({ telefones_completados: 1, skipped_duplicates: 1 });
    expect(db.completados).toHaveLength(1);
  });

  it("completa o e-mail de quem já existe pelo telefone", async () => {
    const db = banco({ existentes: [{ id: "c-2", phone_number: "+5511900000001", email_normalized: null }] });
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], CABECALHO);

    expect(resumo).toMatchObject({ emails_completados: 1, telefones_completados: 0 });
    expect(db.completados).toEqual([{ id: "c-2", campos: { email: "ana@example.invalid" } }]);
  });

  it("nunca troca o telefone de quem já tem um: conta como repetido e avisa", async () => {
    const db = banco({
      existentes: [{ id: "c-1", email_normalized: "ana@example.invalid", phone_number: "+5531900000009" }],
    });
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], CABECALHO);

    expect(resumo).toMatchObject({
      skipped_duplicates: 1,
      telefones_completados: 0,
      avisos: [{ linha: 2, motivo: "O contato deste e-mail já tem outro telefone, e ele foi mantido." }],
    });
    expect(db.completados).toHaveLength(0);
  });

  it("telefone de um contato e e-mail de outro: nada muda, e a linha avisa", async () => {
    const db = banco({
      existentes: [
        { id: "c-1", email_normalized: "ana@example.invalid", phone_number: null },
        { id: "c-2", email_normalized: null, phone_number: "+5511900000001" },
      ],
    });
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], CABECALHO);

    expect(resumo.skipped_duplicates).toBe(1);
    expect(resumo.avisos[0]?.motivo).toContain("Duplicados");
    expect(db.completados).toHaveLength(0);
    expect(db.tentativas).toHaveLength(0);
  });

  it("contato anonimizado não é completado (LGPD)", async () => {
    const db = banco({
      existentes: [{ id: "c-1", email_normalized: "ana@example.invalid", phone_number: null, is_anonymized: true }],
    });
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], CABECALHO);

    expect(resumo).toMatchObject({ skipped_duplicates: 1, telefones_completados: 0 });
    expect(db.completados).toHaveLength(0);
  });

  it("o telefone que outro contato pegou no meio (23505) conta como repetido", async () => {
    banco({
      existentes: [{ id: "c-1", email_normalized: "ana@example.invalid", phone_number: null }],
      falhaAoCompletar: { code: "23505", message: "uniq_contacts_org_phone" },
    });
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], CABECALHO);

    expect(resumo).toMatchObject({ skipped_duplicates: 1, telefones_completados: 0, errors: [] });
  });

  it("sem coluna de telefone: o resumo diz, e nomeia as colunas ignoradas", async () => {
    banco();
    const resumo = await importar(["Ana,+5511900000001,ana@example.invalid"], "nome,fone do trabalho,email");

    expect(resumo).toMatchObject({
      imported: 1,
      sem_telefone: 1,
      sem_coluna_de_telefone: true,
      colunas_ignoradas: ["fone do trabalho"],
    });
  });

  it("as 565 linhas da planilha entram, e a leitura de quem existe vai em lotes", async () => {
    const db = banco();
    const linhas = Array.from({ length: 565 }, (_, i) => {
      const n = String(i).padStart(8, "0");
      return `Pessoa ${i},+55119${n},pessoa${i}@example.invalid`;
    });
    const resumo = await importar(linhas, CABECALHO);

    expect(resumo).toMatchObject({ total_linhas: 565, imported: 565, errors: [] });
    expect(db.lotesLidos.every((lote) => lote.length <= 100)).toBe(true);
  });

  it("acima do teto de contatos, o arquivo inteiro é recusado com o número", async () => {
    banco();
    const form = new FormData();
    const linhas = Array.from({ length: 2001 }, (_, i) => `P,,p${i}@example.invalid`);
    form.set("file", new File([[CABECALHO, ...linhas].join("\n")], "c.csv", { type: "text/csv" }));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", { method: "POST", body: form }));

    expect(resposta.status).toBe(422);
    expect(await resposta.text()).toContain("2000");
  });

  it("a leitura de quem existe falha: recusa antes de gravar a primeira linha", async () => {
    const db = banco({ leituraFalha: true });
    const form = new FormData();
    form.set("file", new File([[CABECALHO, "Ana,+5511900000001,"].join("\n")], "c.csv", { type: "text/csv" }));
    const resposta = await POST(new NextRequest("http://localhost/api/v1/contacts/import", { method: "POST", body: form }));

    expect(resposta.status).toBe(500);
    expect(db.tentativas).toHaveLength(0);
  });
});
