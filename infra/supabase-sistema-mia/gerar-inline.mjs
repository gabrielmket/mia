// gerar-inline.mjs — monta docker-compose.inline.yml a partir desta pasta.
//
// POR QUE EXISTE: o serviço supabase-sistema-mia nasceu do template git do
// EasyPanel, e o template grava o banco DENTRO da pasta do clone
// (./volumes/db/data). Com o clone sujo, o EasyPanel não troca de repositório
// ("Failed to change branch", 28/09/2026). A saída é a fonte INLINE: o compose
// vai inteiro no painel, e os arquivos que o oficial monta por bind (kong.yml,
// SQL de init, migrar.sh) entram como `configs` com o conteúdo embutido.
//
// A FONTE DA VERDADE continua sendo docker-compose.yml + volumes/ + migrador/ + backup/.
// Mudou algo? Rode `node gerar-inline.mjs` e cole o resultado no painel (ou pelo
// MCP: updateComposeSourceInline). O teste de mesa é `docker compose -f
// docker-compose.inline.yml config -q`.
//
// `$` vira `$$` no conteúdo embutido: o compose interpola variáveis em TODO o
// arquivo, inclusive no `content` de um config, e o kong.yml/migrar.sh/SQL
// estão cheios de `$` que não são do compose.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(aqui, p), "utf8");

const ARQUIVOS = {
  kong_yml: "volumes/api/kong.yml",
  kong_entrypoint: "volumes/api/kong-entrypoint.sh",
  db_realtime: "volumes/db/realtime.sql",
  db_webhooks: "volumes/db/webhooks.sql",
  db_roles: "volumes/db/roles.sql",
  db_jwt: "volumes/db/jwt.sql",
  db_supabase: "volumes/db/_supabase.sql",
  db_logs: "volumes/db/logs.sql",
  db_pooler: "volumes/db/pooler.sql",
  migrar_sh: "migrador/migrar.sh",
  // O backup-envio sobe o LEIA-ME.txt para a raiz do drive a cada volta. O
  // testar-restauracao.sh roda fora da VPS e não entra.
  fazer_backup_sh: "backup/fazer-backup.sh",
  enviar_sh: "backup/enviar.sh",
  backup_leia_me: "backup/LEIA-ME.txt",
};

let c = ler("docker-compose.yml");
const troca = (de, para) => {
  if (c.split(de).length !== 2) throw new Error(`âncora não única: ${de.slice(0, 60)}`);
  c = c.replace(de, () => para);
};

troca(
  `    volumes:
      - ./volumes/api/kong.yml:/home/kong/temp.yml:ro,z
      - ./volumes/api/kong-entrypoint.sh:/home/kong/kong-entrypoint.sh:ro,z
`,
  `    configs:
      - source: kong_yml
        target: /home/kong/temp.yml
      - source: kong_entrypoint
        target: /home/kong/kong-entrypoint.sh
`,
);
troca(
  `      - ./volumes/db/realtime.sql:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:Z
      - ./volumes/db/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:Z
      - ./volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:Z
      - ./volumes/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:Z
      - ./volumes/db/_supabase.sql:/docker-entrypoint-initdb.d/migrations/97-_supabase.sql:Z
      - ./volumes/db/logs.sql:/docker-entrypoint-initdb.d/migrations/99-logs.sql:Z
      - ./volumes/db/pooler.sql:/docker-entrypoint-initdb.d/migrations/99-pooler.sql:Z
`,
  "",
);
troca(
  `    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"]`,
  `    configs:
      - source: db_realtime
        target: /docker-entrypoint-initdb.d/migrations/99-realtime.sql
      - source: db_webhooks
        target: /docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql
      - source: db_roles
        target: /docker-entrypoint-initdb.d/init-scripts/99-roles.sql
      - source: db_jwt
        target: /docker-entrypoint-initdb.d/init-scripts/99-jwt.sql
      - source: db_supabase
        target: /docker-entrypoint-initdb.d/migrations/97-_supabase.sql
      - source: db_logs
        target: /docker-entrypoint-initdb.d/migrations/99-logs.sql
      - source: db_pooler
        target: /docker-entrypoint-initdb.d/migrations/99-pooler.sql
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"]`,
);
troca(
  `    volumes:
      - ./migrador:/migrador:ro
`,
  `    configs:
      - source: migrar_sh
        target: /migrador/migrar.sh
`,
);
// Os dois serviços do backup montam a mesma pasta: a âncora inclui o entrypoint,
// que é o que difere entre eles.
troca(
  `    entrypoint: ["bash", "/backup-scripts/fazer-backup.sh"]
    volumes:
      - ./backup:/backup-scripts:ro
`,
  `    entrypoint: ["bash", "/backup-scripts/fazer-backup.sh"]
    configs:
      - source: fazer_backup_sh
        target: /backup-scripts/fazer-backup.sh
    volumes:
`,
);
troca(
  `    entrypoint: ["sh", "/backup-scripts/enviar.sh"]
    volumes:
      - ./backup:/backup-scripts:ro
`,
  `    entrypoint: ["sh", "/backup-scripts/enviar.sh"]
    configs:
      - source: enviar_sh
        target: /backup-scripts/enviar.sh
      - source: backup_leia_me
        target: /backup-scripts/LEIA-ME.txt
    volumes:
`,
);
const naoComentario = c.split("\n").filter((l) => !l.trimStart().startsWith("#"));
if (naoComentario.some((l) => /\.\/(volumes|migrador|backup)/.test(l))) throw new Error("sobrou bind mount relativo");

const blocos = Object.entries(ARQUIVOS).map(([nome, arq]) => {
  const corpo = ler(arq)
    .replace(/\r\n/g, "\n")
    .replace(/\$/g, "$$$$")
    .split("\n")
    .map((l) => (l.length ? `      ${l}` : ""))
    .join("\n");
  return `  ${nome}:\n    content: |\n${corpo}\n`;
});

const cabeca =
  "# GERADO por gerar-inline.mjs a partir de docker-compose.yml desta pasta. Não edite à mão.\n";
writeFileSync(join(aqui, "docker-compose.inline.yml"), cabeca + c.trimEnd() + "\n\nconfigs:\n" + blocos.join(""));
console.log("docker-compose.inline.yml gerado");
