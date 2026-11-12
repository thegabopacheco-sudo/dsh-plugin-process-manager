# dsh-plugin-process-manager — Process Manager

Lista y termina procesos de Windows con filtros y orden por memoria, con confirmacion para matar y reporte real de PIDs.

## Herramientas

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `list` | Listar procesos |
| `kill` | Terminar proceso |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-process-manager` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-process-manager
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_PROCESS_MANAGER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\process-manager\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
