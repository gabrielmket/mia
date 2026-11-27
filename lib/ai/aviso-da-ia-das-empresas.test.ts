/**
 * FORK MIA (MIA-218) · a regra do aviso da trava (lib/ai/aviso-da-ia-das-empresas.ts).
 */
import { describe, expect, it } from "vitest";

import {
  blocoDaSaude,
  contarEmpresasSemChave,
  recadoDaIaSemChave,
  type IaParaOAviso,
} from "./aviso-da-ia-das-empresas";

const SEGUE_COM_CHAVE: IaParaOAviso = { chave: "instalacao", operante: true };
const PROPRIA_COM_CHAVE: IaParaOAviso = { chave: "propria", operante: true };
const SEM_CHAVE: IaParaOAviso = { chave: null, operante: true };
const SUSPENSA_SEM_CHAVE: IaParaOAviso = { chave: null, operante: false };

describe("contarEmpresasSemChave", () => {
  it("conta só a operante sem chave utilizável", () => {
    expect(contarEmpresasSemChave([SEGUE_COM_CHAVE, PROPRIA_COM_CHAVE, SEM_CHAVE, SEM_CHAVE, SUSPENSA_SEM_CHAVE])).toBe(2);
  });

  it("sem empresa nenhuma é zero", () => {
    expect(contarEmpresasSemChave([])).toBe(0);
  });
});

describe("blocoDaSaude", () => {
  it("é só a contagem", () => {
    expect(blocoDaSaude({ empresas: [SEM_CHAVE, SEGUE_COM_CHAVE] })).toEqual({ empresas_sem_chave: 1 });
  });

  it("leitura que falhou é null, e não zero", () => {
    expect(blocoDaSaude({ falha: true })).toEqual({ empresas_sem_chave: null });
  });
});

describe("recadoDaIaSemChave", () => {
  it("zero não fala", () => {
    expect(recadoDaIaSemChave(0)).toBeNull();
  });

  it("diz quantas, onde ver e onde corrigir, sem nome de empresa", () => {
    const uma = recadoDaIaSemChave(1)!;
    expect(uma).toContain("1 empresa está");
    expect(uma).toContain("ela não responde");
    const varias = recadoDaIaSemChave(14)!;
    expect(varias).toContain("14 empresas estão");
    expect(varias).toContain("plataforma_ver_ia_das_empresas");
    expect(varias).toContain("Admin › Modelo de IA");
  });
});

describe("FORK MIA (MIA-262): o Jev sem chave vai para a plataforma", () => {
  it("conta só empresa operante com o Jev ligado e sem chave da origem dele", async () => {
    const { contarJevSemChave } = await import("./aviso-da-ia-das-empresas");
    expect(
      contarJevSemChave([
        { chave: "propria", operante: true, jevSemChave: true },
        { chave: "propria", operante: false, jevSemChave: true },
        { chave: "instalacao", operante: true, jevSemChave: false },
        { chave: "instalacao", operante: true },
      ]),
    ).toBe(1);
  });

  it("o recado diz o que acontece e onde ver, sem nome de empresa; zero não manda nada", async () => {
    const { recadoDoJevSemChave } = await import("./aviso-da-ia-das-empresas");
    expect(recadoDoJevSemChave(0)).toBeNull();
    const recado = recadoDoJevSemChave(2)!;
    expect(recado).toMatch(/2 empresas estão com o Jev ligado/);
    expect(recado).toMatch(/plataforma_ver_ia_das_empresas/);
    expect(recado).toMatch(/a IA de sempre cobre/);
  });
});
