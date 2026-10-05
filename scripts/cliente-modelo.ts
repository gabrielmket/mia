/**
 * FORK MIA · AS EMPRESAS DE DEMONSTRAÇÃO — grava (ou renova) uma ou todas.
 *
 * São cinco, todas da mesma semente (`lib/demonstracao/semente/`):
 *
 *   bancada          a "Empresa Modelo · Demonstração", a bancada de teste (padrão)
 *   construtora      "Demonstração · Construtora"
 *   clinica-odonto   "Demonstração · Clínica Odontológica"
 *   industria        "Demonstração · Indústria"
 *   academia         "Demonstração · Academia"
 *   todos            as cinco, uma depois da outra (cada uma na sua transação)
 *
 * Uso:
 *
 *   # conectado ao Postgres
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts --segmento construtora            # só mostra o alvo
 *   CLIENTE_MODELO_DATABASE_URL='postgresql://…' npx tsx scripts/cliente-modelo.ts --segmento construtora --aplicar  # grava
 *
 *   # sem conexão: gera o SQL (para o /pg/query do postgres-meta, ou psql)
 *   npx tsx scripts/cliente-modelo.ts --segmento industria --sql industria.sql
 *   npx tsx scripts/cliente-modelo.ts --segmento todos --sql demonstracoes.sql   # um arquivo por segmento:
 *                                                                                # demonstracoes-bancada.sql, …
 *
 * Sem `--segmento`, é a bancada, como sempre foi.
 *
 * Variáveis:
 *
 *   CLIENTE_MODELO_DATABASE_URL       a connection string do Postgres (só no modo conectado).
 *                                     Nunca no código nem em arquivo versionado — só no
 *                                     ambiente de quem roda. Com SSL: `?sslmode=require`.
 *   CLIENTE_MODELO_EMAILS_DE_ACESSO   e-mails, separados por vírgula, de usuários que JÁ
 *                                     existem e ganham acesso de admin à demonstração. No SQL
 *                                     gerado, o usuário é achado pelo e-mail dentro do banco.
 *
 * O banco precisa ter as migrations 9010 (a marca e a trava) e 9018 (documentos e
 * obrigações): sem elas a semente para antes de gravar qualquer coisa — nos dois
 * modos, a conferência é SQL. Idempotente: rodar de novo não duplica, e renova as
 * datas relativas (no SQL gerado, as datas são as do momento em que ele foi gerado).
 *
 * Ver docs/fork/cliente-modelo.md.
 */
import { writeFileSync } from "node:fs";

import pg from "pg";

import { aplicarSemente, gerarSqlDaSemente } from "../lib/demonstracao/semente/aplicar";
import { sementeDoSegmento } from "../lib/demonstracao/semente/segmentos";
import {
  ehSegmentoDeDemonstracao,
  SEGMENTOS_DE_DEMONSTRACAO,
  type SegmentoDeDemonstracao,
} from "../lib/demonstracao/semente/tipos";

function alvoLegivel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} (usuário ${decodeURIComponent(u.username) || "?"})`;
  } catch {
    return "(connection string ilegível)";
  }
}

function emailsDeAcesso(): string[] {
  return (process.env.CLIENTE_MODELO_EMAILS_DE_ACESSO ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Os segmentos pedidos por `--segmento` (padrão: a bancada). */
function segmentosPedidos(): SegmentoDeDemonstracao[] {
  const i = process.argv.indexOf("--segmento");
  if (i < 0) return ["bancada"];
  const valor = process.argv[i + 1];
  if (valor === "todos") return [...SEGMENTOS_DE_DEMONSTRACAO];
  if (!ehSegmentoDeDemonstracao(valor)) {
    console.error(
      `Segmento desconhecido: "${valor ?? ""}". Use um destes: ${SEGMENTOS_DE_DEMONSTRACAO.join(", ")} ou todos.`,
    );
    process.exit(2);
  }
  return [valor];
}

/** Com mais de um segmento, um arquivo por segmento: `base.sql` vira `base-<segmento>.sql`. */
function arquivoDoSegmento(arquivo: string, segmento: SegmentoDeDemonstracao, varios: boolean): string {
  if (!varios) return arquivo;
  return /\.sql$/i.test(arquivo) ? arquivo.replace(/\.sql$/i, `-${segmento}.sql`) : `${arquivo}-${segmento}.sql`;
}

async function gerarSql(arquivo: string | undefined, segmentos: SegmentoDeDemonstracao[]): Promise<void> {
  if (!arquivo || arquivo.startsWith("--")) {
    console.error("Diga onde gravar: --sql <arquivo>.");
    process.exit(2);
  }
  for (const segmento of segmentos) {
    const destino = arquivoDoSegmento(arquivo, segmento, segmentos.length > 1);
    const texto = await gerarSqlDaSemente({ segmento, emailsDeAcesso: emailsDeAcesso() });
    writeFileSync(destino, texto, "utf8");
    const kb = Math.round(Buffer.byteLength(texto, "utf8") / 1024);
    console.info(`SQL da "${sementeDoSegmento(segmento).nome}" gravado em ${destino} (${kb} KB).`);
  }
  console.info("Cada arquivo é uma transação só, idempotente; sem a migration 9010 ele aborta antes de gravar.");
}

async function main(): Promise<void> {
  const segmentos = segmentosPedidos();
  const iSql = process.argv.indexOf("--sql");
  if (iSql >= 0) return gerarSql(process.argv[iSql + 1], segmentos);

  const url = process.env.CLIENTE_MODELO_DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "Defina CLIENTE_MODELO_DATABASE_URL com a connection string do Postgres de destino, " +
        "ou use --sql <arquivo> para gerar o SQL sem conectar.",
    );
    process.exit(2);
  }
  const aplicar = process.argv.includes("--aplicar");

  console.info(`Alvo: ${alvoLegivel(url)}`);
  console.info(`Empresas: ${segmentos.map((s) => sementeDoSegmento(s).nome).join(", ")}`);
  if (!aplicar) {
    console.info("Nada foi gravado. Rode de novo com --aplicar para gravar a empresa de demonstração.");
    return;
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    for (const segmento of segmentos) {
      const resumo = await aplicarSemente(cliente, { segmento, emailsDeAcesso: emailsDeAcesso() });
      console.info(`Empresa de demonstração (${segmento}): ${resumo.organizacaoId}`);
      for (const [tabela, n] of Object.entries(resumo.contagens)) console.info(`  ${tabela.padEnd(28)} ${n}`);
      for (const aviso of resumo.avisos) console.warn(`  aviso: ${aviso}`);
    }
  } finally {
    await cliente.end();
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
