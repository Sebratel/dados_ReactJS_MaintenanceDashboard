#!/usr/bin/env python3
"""
Analise de reparos recorrentes - RELATORIO_RESUMO_MAIO-AGO.csv

Uso:
    python scripts/analisar_recorrencia.py [caminho_do_csv] [--mes 2026-08]

Regra de recorrencia (definicao do negocio):
    Cliente e recorrente no mes M se tiver >= 2 aberturas de reparo
    na janela [M-1, M] -- ou seja, repeticao dentro do proprio mes
    OU entre o mes anterior e o mes de referencia.

Saida: agregados compactos no stdout. NUNCA imprime o CSV inteiro.
"""
import argparse
import sys

import pandas as pd

COL_DATA = "Dt. criação"
COL_PROTO = "Protocolo"


def carregar(caminho: str) -> pd.DataFrame:
    """Le o CSV e normaliza. utf-8-sig por causa do BOM do export."""
    df = pd.read_csv(caminho, encoding="utf-8-sig")
    df["dt"] = pd.to_datetime(df[COL_DATA])
    df["mes"] = df["dt"].dt.to_period("M")
    return df


def deduplicar(df: pd.DataFrame) -> pd.DataFrame:
    """
    A chave de recorrencia e `user`, entao o evento e protocolo x user
    -- exatamente o grao do export. So removemos repeticao exata do par.
    """
    return df.drop_duplicates(subset=[COL_PROTO, "user"])


def recorrentes(base: pd.DataFrame, chave: str, mes_ref: pd.Period):
    """Retorna (serie de recorrentes, qtd de chaves distintas no mes)."""
    janela = base[base["mes"].isin([mes_ref - 1, mes_ref])]
    contagem = janela.groupby(chave).size()
    return contagem[contagem >= 2], base[base["mes"] == mes_ref][chave].nunique()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="?", default="RELATÓRIO_RESUMO_MAIO-AGO.csv")
    ap.add_argument("--mes", default="2026-08", help="mes de referencia YYYY-MM")
    ap.add_argument("--chave", default="user", choices=["user", "ETIQUETA", "Cliente"])
    ap.add_argument("--catalogo", default=None, help="ex: 'Oper. Reparo' para filtrar")
    ap.add_argument("--top", type=int, default=20)
    args = ap.parse_args()

    df = carregar(args.csv)
    prot = deduplicar(df)

    print(f"Linhas no arquivo   : {len(df)}")
    print(f"Eventos (proto+user): {len(prot)}")
    print(f"Protocolos unicos   : {prot[COL_PROTO].nunique()}\n")

    if args.catalogo:
        prot = prot[prot["Catálogo"] == args.catalogo]
        print(f"Filtro Catalogo = {args.catalogo!r} -> {len(prot)} protocolos\n")

    print("Aberturas por mes")
    print(prot.groupby("mes").size().to_string(), "\n")

    mes_ref = pd.Period(args.mes)
    print(f"Recorrencia (janela {mes_ref - 1} + {mes_ref}, chave={args.chave})")
    for m in sorted(prot["mes"].unique())[1:]:
        rec, distintos = recorrentes(prot, args.chave, m)
        pct = 100 * len(rec) / distintos if distintos else 0
        print(f"  {m}: {len(rec):>4} recorrentes | {distintos:>4} distintos | {pct:5.1f}%")

    rec, _ = recorrentes(prot, args.chave, mes_ref)
    print(f"\nTop {args.top} recorrentes em {mes_ref}")
    info = prot.drop_duplicates(args.chave).set_index(args.chave)[["Cliente", "Cidade"]]
    top = rec.sort_values(ascending=False).head(args.top).rename("aberturas").to_frame()
    print(top.join(info).to_string())

    print("\nConcentracao: recorrentes por cliente (top 10)")
    donos = prot[prot[args.chave].isin(rec.index)].drop_duplicates(args.chave)
    print(donos["Cliente"].value_counts().head(10).to_string())

    return 0


if __name__ == "__main__":
    sys.exit(main())
