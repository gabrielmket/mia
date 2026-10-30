import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/contacts/import — importa contatos de planilha CSV.
 *
 * Formato aceito: CSV RFC 4180 com linha de cabeçalho (delimitador detectado
 * automaticamente entre vírgula, ponto-e-vírgula e tabulação — Excel pt-BR
 * exporta ";"). Colunas reconhecidas e apelidos em `lib/contacts/csv.ts`.
 * XLSX é recusado na borda com instrução de exportar como CSV.
 *
 * Desfecho POR LINHA, nunca do lote inteiro:
 *   - linha inválida é pulada com motivo nominal (vem no response);
 *   - contato que já existe (telefone/e-mail/CPF da org) é contado como
 *     duplicado, não como erro. FORK MIA (.97): antes de contar, ele ganha o
 *     telefone ou o e-mail que lhe faltava, se a linha traz e é livre
 *     (`lib/contacts/completar-na-importacao.ts`);
 *   - as demais linhas seguem mesmo se uma falhar — uma planilha de 400 nomes
 *     não pode morrer inteira pelo telefone malformado da linha 7.
 *
 * Insert é linha a linha de propósito: `contacts` tem índices únicos parciais
 * (org+phone/org+email/org+cpf) e um insert em lote viraria tudo-ou-nada —
 * o 23505 de UM conflito descartaria as outras centenas criadas.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { camposCpfParaGravar } from "@/lib/contacts/cpf";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  COLUNAS_DO_CONTATO_NA_BASE,
  ContatosConhecidos,
  decidirLinha,
  fraseDoAviso,
  type ContatoNaBase,
} from "@/lib/contacts/completar-na-importacao";
import {
  colunasIgnoradas,
  CSV_MAX_BYTES,
  CSV_MAX_CONTATOS_POR_ARQUIVO,
  decodificarCsv,
  mapHeader,
  mapLinha,
  parseCsv,
} from "@/lib/contacts/csv";
import { contactCreateSchemaDoPais } from "@/lib/schemas";
import { perfilDaOrganizacao } from "@/lib/legal/perfil-do-pais";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SOURCE_IMPORT_CSV = "import_csv";

interface LinhaErro {
  linha: number;
  motivo: string;
}

interface ImportSummary {
  total_linhas: number;
  imported: number;
  skipped_duplicates: number;
  errors: LinhaErro[];
  // FORK MIA (.97): o resumo diz o que aconteceu com o telefone.
  /** Contatos que já existiam e ganharam o telefone que faltava. */
  telefones_completados: number;
  /** Contatos que já existiam e ganharam o e-mail que faltava. */
  emails_completados: number;
  /** Linhas válidas sem telefone: entram na base e não recebem WhatsApp. */
  sem_telefone: number;
  /** Nenhuma coluna do arquivo foi reconhecida como telefone. */
  sem_coluna_de_telefone: boolean;
  /** As colunas do arquivo que a importação não leu. */
  colunas_ignoradas: string[];
  /** O que não é erro, mas quem importa precisa saber (por linha). */
  avisos: LinhaErro[];
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only), igual ao POST unitário.
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId;
  const t = (texto: string) => traduzir(texto, user.idioma);

  // O documento do titular, na régua do PAÍS da organização (issue #1033): o
  // cabeçalho aceito, a normalização do valor e a validação saem daqui. O país
  // vem da coluna da organização — nunca do arquivo enviado.
  const perfil = await perfilDaOrganizacao(supabase, orgId);
  const doc = perfil.documento;
  const schemaDoPais = contactCreateSchemaDoPais(perfil);

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("sem arquivo");
    file = f;
  } catch {
    return fail(
      "validation_failed",
      t("Envie o arquivo como multipart/form-data no campo 'file'."),
      422,
      { requestId },
    );
  }

  const nome = file.name ?? "";
  const tipoOk =
    nome.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";
  if (!tipoOk) {
    return fail(
      "validation_failed",
      t("Formato não suportado — envie um arquivo .csv. No Excel use 'Salvar como' → 'CSV UTF-8'."),
      422,
      { requestId },
    );
  }
  if (file.size > CSV_MAX_BYTES) {
    return fail(
      "validation_failed",
      t("Arquivo maior que ") + `${Math.floor(CSV_MAX_BYTES / 1024 / 1024)}MB.`,
      413,
      { requestId },
    );
  }

  // ─── Parse + validação de linhas (puro; nada tocou no banco ainda) ───────
  // Os BYTES, não `file.text()` — ver `decodificarCsv` (#483).
  const decodificado = decodificarCsv(await file.arrayBuffer());
  if ("erro" in decodificado) {
    return fail("validation_failed", t(decodificado.erro), 422, { requestId });
  }
  const text = decodificado.texto;
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return fail("validation_failed", t("CSV vazio ou sem linhas de dados."), 422, { requestId });
  }
  const header = rows[0]!;
  const mapeado = mapHeader(header, t, doc);
  if (mapeado.motivo !== null) {
    return fail("validation_failed", `${t("Cabeçalho inválido:")} ${mapeado.motivo}.`, 422, {
      details: { header: header.join(", ") },
      requestId,
    });
  }
  const indices = mapeado.indices;

  const dataRows = rows.slice(1);
  // FORK MIA (.97): o teto próprio dos contatos (ver a constante).
  if (dataRows.length > CSV_MAX_CONTATOS_POR_ARQUIVO) {
    return fail(
      "validation_failed",
      `${t("Máximo de")} ${CSV_MAX_CONTATOS_POR_ARQUIVO} ${t("linhas por importação — divida a planilha.")}`,
      422,
      { requestId },
    );
  }

  const candidatos: Array<{ linha: number; contato: Record<string, unknown> }> = [];
  const errors: LinhaErro[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const linha = i + 2; // 1-based contando o cabeçalho — bate com o editor de planilhas.
    const { contato, motivo } = mapLinha(dataRows[i]!, indices, t, doc, perfil.telefoneExemplo);
    if (motivo !== null) {
      errors.push({ linha, motivo });
      continue;
    }
    if (contato.cpf && !doc.valida(contato.cpf)) {
      // O texto sai do PERFIL: no Brasil continua "CPF inválido: …" (a mesma
      // chave do dicionário), e país sem checksum público diz na mensagem que a
      // conferência é de FORMA — prometer dígito verificado que não existe é o
      // que a issue #1033 proíbe.
      errors.push({ linha, motivo: t(doc.mensagemInvalido + ": ") + `"${contato.cpf}"` });
      continue;
    }
    const parsed = schemaDoPais.safeParse({ ...contato, source: SOURCE_IMPORT_CSV });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      errors.push({ linha, motivo: primeiro?.message ?? t("dados inválidos") });
      continue;
    }
    candidatos.push({ linha, contato: parsed.data as Record<string, unknown> });
  }

  // FORK MIA (.97): o que o resumo diz sobre o arquivo, com ou sem gravação.
  const sobreOArquivo = {
    sem_telefone: candidatos.filter((c) => !c.contato.phone_number).length,
    sem_coluna_de_telefone: indices.phone_number === undefined,
    colunas_ignoradas: colunasIgnoradas(header, indices),
  };

  if (candidatos.length === 0) {
    const resumo: ImportSummary = {
      total_linhas: dataRows.length,
      imported: 0,
      skipped_duplicates: 0,
      errors,
      telefones_completados: 0,
      emails_completados: 0,
      avisos: [],
      ...sobreOArquivo,
    };
    return ok(resumo, { requestId });
  }

  // ─── Pré-filtro de duplicados contra o banco (uma query por identificador) ──
  //
  // Os índices únicos são parciais (excluem mesclados/anonimizados), então a
  // busca espelha o WHERE do índice — filtrar pelo que o índice não cobre
  // produziria "duplicado" imaginário.
  const phones = candidatos
    .map((c) => c.contato.phone_number as string | undefined)
    .filter((p): p is string => typeof p === "string");
  const emails = candidatos
    .map((c) => c.contato.email as string | undefined)
    .filter((e): e is string => typeof e === "string");

  // FORK MIA (.97): a leitura traz o CONTATO, e não só o identificador, porque
  // quem já existe pode ser completado. E vem em LOTES: planilha de 500 e-mails
  // num `.in()` só passa do teto da URL (`lib/supabase/em-lotes.ts`), e o erro
  // era ignorado aqui: todos caíam no 23505 e viravam duplicado sem nada completar.
  // Sem saber quem existe não há como decidir, então a leitura que falha recusa
  // antes de gravar a primeira linha.
  //
  // `is_merged_into` é o conserto do upstream (#3620, EPIC-05): ficha absorvida
  // por mesclagem não é contato vivo, e o índice único também não a conta.
  const conhecidos = new ContatosConhecidos();
  const lidos = await Promise.all([
    buscaEmLotes<ContatoNaBase>([...new Set(phones.flatMap((p) => phoneLookupVariants(p)))], (lote) =>
      supabase
        .from("contacts")
        .select(COLUNAS_DO_CONTATO_NA_BASE)
        .eq("organization_id", orgId)
        .is("is_merged_into", null)
        .not("phone_number", "is", null)
        .in("phone_number", lote),
    ),
    buscaEmLotes<ContatoNaBase>([...new Set(emails.map((e) => e.toLowerCase()))], (lote) =>
      supabase
        .from("contacts")
        .select(COLUNAS_DO_CONTATO_NA_BASE)
        .eq("organization_id", orgId)
        .is("is_merged_into", null)
        .in("email_normalized", lote),
    ),
  ]);
  for (const leitura of lidos) {
    if (leitura.error) {
      return fail("query_failed", t("Não consegui conferir quem já está na base. Tente de novo."), 500, {
        requestId,
      });
    }
    for (const contato of leitura.data) conhecidos.lembrar(contato);
  }

  // ─── Insert linha a linha com desfecho individual ─────────────────────────
  let imported = 0;
  let skippedDuplicates = 0;
  let telefonesCompletados = 0;
  let emailsCompletados = 0;
  const avisos: LinhaErro[] = [];

  for (const { linha, contato } of candidatos) {
    const phone = contato.phone_number as string | undefined;
    const email = contato.email as string | undefined;
    // Só contatos existentes ou gravados com sucesso são conhecidos.
    // Cada repetição chega aqui para ter desfecho; uma linha inválida ou que
    // falhou no insert não pode descartar outra válida do mesmo arquivo.
    const desfecho = decidirLinha({ phone, email }, conhecidos);
    if (desfecho.tipo !== "criar" && desfecho.aviso) {
      avisos.push({ linha, motivo: fraseDoAviso(desfecho.aviso, t) });
    }
    if (desfecho.tipo === "duplicado") {
      skippedDuplicates += 1;
      continue;
    }
    if (desfecho.tipo === "completar") {
      // FORK MIA (.97): só o que estava vazio, e sem `contact.phone_added`: a
      // importação não dispara a automação de "ganhou um telefone", para não
      // virar um disparo em massa.
      const { data: completado, error: erroAoCompletar } = await supabase
        .from("contacts")
        .update({ ...desfecho.campos, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("id", desfecho.contato.id)
        .select(COLUNAS_DO_CONTATO_NA_BASE)
        .maybeSingle();
      if (erroAoCompletar?.code === "23505" || (!erroAoCompletar && !completado)) {
        // Outro contato pegou o dado entre a leitura e a gravação.
        skippedDuplicates += 1;
        continue;
      }
      if (erroAoCompletar) {
        errors.push({ linha, motivo: erroAoCompletar.message });
        continue;
      }
      conhecidos.lembrar(completado as ContatoNaBase);
      if (desfecho.campos.phone_number) telefonesCompletados += 1;
      if (desfecho.campos.email) emailsCompletados += 1;
      // A régua L-06 da edição pela ficha: quem, o quê e de quê para quê.
      await audit({
        action: "contact.updated",
        actorUserId: user.id,
        organizationId: orgId,
        resourceType: "contact",
        resourceId: desfecho.contato.id,
        requestId,
        metadata: {
          actor_type: "user",
          origem: SOURCE_IMPORT_CSV,
          fields: Object.keys(desfecho.campos),
          ...(desfecho.campos.phone_number
            ? { old_phone_number: null, new_phone_number: desfecho.campos.phone_number }
            : {}),
          ...(desfecho.campos.email ? { old_email: null, new_email: desfecho.campos.email } : {}),
        },
      });
      await supabase
        .rpc("emit_event", {
          p_event_type: "contact.updated",
          p_entity_kind: "contact",
          p_entity_id: desfecho.contato.id,
          p_payload: { fields: Object.keys(desfecho.campos) },
          p_metadata: { request_id: requestId, actor_type: "user", source: SOURCE_IMPORT_CSV },
          p_organization_id: orgId,
        })
        .then(({ error }) => {
          if (error) console.error("[contacts.import] emit_event failed", error.message);
        });
      continue;
    }

    const insertRow: Record<string, unknown> = {
      organization_id: orgId,
      created_by_user_id: user.id,
      name: contato.name ?? null,
      display_name: contato.display_name ?? null,
      email: contato.email ?? null,
      phone_number: contato.phone_number ?? null,
      birthdate: contato.birthdate ?? null,
      tags: contato.tags ?? [],
      source: SOURCE_IMPORT_CSV,
      source_metadata: {},
      consent: {},
    };
    if (contato.cpf) {
      // LGPD: hash (dedupe) e versão cifrada nascem JUNTOS — o CHECK
      // `contacts_cpf_consistency` recusa a linha se só um dos dois existir
      // (#2522). Sem cifra disponível a linha segue SEM CPF, em vez de voltar
      // em `errors` e parar a reimportação inteira.
      Object.assign(insertRow, await camposCpfParaGravar(supabase, contato.cpf as string));
    }

    const { data: criado, error: insErr } = await supabase
      .from("contacts")
      .insert(insertRow)
      .select("id, display_name, phone_number")
      .single();

    if (insErr) {
      // Conflito de corrida com os índices únicos = duplicado, não erro.
      if (insErr.code === "23505") {
        skippedDuplicates += 1;
        continue;
      }
      errors.push({ linha, motivo: insErr.message });
      continue;
    }

    imported += 1;
    conhecidos.lembrar({
      id: (criado as { id: string }).id,
      phone_number: phone ?? null,
      email_normalized: email?.toLowerCase() ?? null,
    });

    // Mesmo evento do create unitário — quem consome `contact.created`
    // (workers, métricas) trata importado e manual igual.
    await supabase
      .rpc("emit_event", {
        p_event_type: "contact.created",
        p_entity_kind: "contact",
        p_entity_id: (criado as { id: string }).id,
        p_payload: {
          source: SOURCE_IMPORT_CSV,
          has_email: !!contato.email,
          has_phone: !!contato.phone_number,
          has_cpf: !!contato.cpf,
        },
        p_metadata: { request_id: requestId, actor_type: "user" },
        p_organization_id: orgId,
      })
      .then(({ error }) => {
        if (error) console.error("[contacts.import] emit_event failed", error.message);
      });
  }

  await audit({
    action: "contacts.imported",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "contact",
    resourceId: null,
    requestId,
    metadata: {
      actor_type: "user",
      total_linhas: dataRows.length,
      imported,
      skipped_duplicates: skippedDuplicates,
      erros: errors.length,
      // FORK MIA (.97)
      telefones_completados: telefonesCompletados,
      emails_completados: emailsCompletados,
      sem_telefone: sobreOArquivo.sem_telefone,
    },
  });

  const resumo: ImportSummary = {
    total_linhas: dataRows.length,
    imported,
    skipped_duplicates: skippedDuplicates,
    errors,
    telefones_completados: telefonesCompletados,
    emails_completados: emailsCompletados,
    avisos,
    ...sobreOArquivo,
  };
  return ok(resumo, { requestId });
}
