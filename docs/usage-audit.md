# Auditoria de uso: declarado × Family Link

Compara o que o filho **declarou no app** (gasto de horas) com o que ele **usou
de verdade no celular**, medido pelo Family Link. Roda quando quiser, por filho.

O script `scripts/usage-audit.mjs` abre o banco **só para leitura**
(`readonly: true, fileMustExist: true`): não migra, não escreve, não cria o
arquivo. Pode rodar contra o banco de produção sem risco para o saldo.

## Rodar contra a produção

O banco vive em `/data/kids.db` **dentro do container**, e o container já tem
`DATABASE_PATH` e o `better-sqlite3`. O script vai pelo stdin, a partir de um
clone do repositório no servidor:

```sh
docker exec -i kids-screen-tracker \
  node --input-type=module - --kid lucas --since 2026-10-29 \
  < scripts/usage-audit.mjs
```

Sai a tabela em texto: por dia, o **ganho** e o **declarado** por destino; os
totais por destino; o ganho da janela e o saldo atual. O destino é normalizado
em minúsculas (`Zap` e `ZAP` viram `zap`).

| flag | o quê |
|---|---|
| `--kid <nome>` | `display_name` do filho, sem diferenciar maiúscula. Sem ela, sai um bloco por filho. |
| `--since <YYYY-MM-DD>` | primeiro dia. Padrão: hoje (São Paulo) menos 6 dias. |
| `--familylink <arquivo.json>` | gera o card de comparação (abaixo). Exige `--kid`. |
| `--out <arquivo.html>` | onde gravar o card. Padrão: `usage-card.html`. |

### O card precisa do template, então gere-o com uma cópia do banco

O card lê `scripts/usage-card.template.html` ao lado do script, e pelo stdin
não há "ao lado". Copie o banco para a sua máquina e rode localmente:

```sh
docker cp kids-screen-tracker:/data/kids.db ./kids-audit.db
DATABASE_PATH=./kids-audit.db pnpm usage:audit \
  --kid lucas --familylink lucas.json --out lucas.html
rm ./kids-audit.db
```

Abra o `lucas.html` no celular, tire um print e mande no WhatsApp.

## Coletar o uso real no Family Link

1. No app **Family Link** do pai, abra o filho → **Tempo de uso** (Screen time).
2. Para cada dia da janela, abra o gráfico diário e anote os minutos de
   **WhatsApp**, **Instagram** e **Chrome**. Tire print de cada dia: é a prova.
3. Anote o modelo do aparelho (aparece no topo, ex.: `SM-A155M`).
4. Transcreva para o JSON, em **minutos por app por dia**:

```json
{
  "device": "SM-A155M",
  "days": {
    "2026-10-29": { "whatsapp": 172, "instagram": 120, "chrome": 28 },
    "2026-10-30": { "whatsapp": 95, "instagram": 40, "chrome": 0 }
  }
}
```

Os dias do JSON **são a janela do card**: o declarado do card é somado só
nesses dias, independentemente do `--since`. App ausente num dia conta 0.

## As regras do card

- **Só três apps contam:** WhatsApp, Instagram e Chrome.
- **1h por dia de WhatsApp é grátis.** Permitido do WhatsApp = 1h × número de
  dias + o WhatsApp declarado no app. Os outros apps não têm hora grátis.
- **Chrome não se pede no app**, então o permitido dele é 0 e todo uso aparece
  como "não declarou".
- Por app: **em dia** se usou ≤ permitido; senão **+Xh**, o quanto passou.
- O número grande é a soma do que passou nos três apps.
- Cores: só as da D42; "passou" em vermelho é a emenda #131 à D42.

## Mapa de destinos

| destino no app | conta como |
|---|---|
| `Zap`, `WhatsApp` | WhatsApp |
| `Insta`, `Instagram` | Instagram |
| `Tv`, `Xbox`, `PlayStation` | **não entram**: TV e console não estão no Family Link do celular |

Destino novo que deveria contar entra em `APPS`, no topo do script.
