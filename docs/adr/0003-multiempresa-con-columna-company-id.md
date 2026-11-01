# 0003 · Multiempresa con base de datos compartida y columna `company_id`

- **Estado:** Propuesta
- **Fecha:** 2026-11-01
- **Tareas:** RIKDP-86 (HU07-T01), RIKDP-87 (HU07-T02), HU23, HU30, HU31, HU32

## Contexto

Varias empresas (plantas de fundición) usan la misma aplicación. Un administrador nunca debe ver ni modificar datos de otra empresa (HU30, HU31), y un superadministrador gestiona todas las empresas (HU23). El número esperado de empresas en el piloto es pequeño (decenas como mucho).

## Decisión

- Una sola base de datos y un solo esquema. Toda tabla de negocio tiene una columna **`company_id`** obligatoria.
- La empresa activa se obtiene **siempre de la sesión** del servidor, nunca de parámetros enviados por el cliente.
- El acceso a datos pasa por una capa común (cliente de Prisma extendido o funciones de repositorio) que añade `company_id` a cada consulta y escritura. Las consultas sin esa capa están prohibidas en el código de negocio.
- Las claves únicas de negocio se definen por empresa, por ejemplo `UNIQUE (company_id, code)`.
- Los índices empiezan por `company_id` en las tablas grandes (inspecciones y eventos).
- El superadministrador (`company_id` nulo) usa operaciones explícitas de plataforma, separadas de las de empresa.

## Alternativas consideradas

| Alternativa | Por qué no |
| --- | --- |
| Un esquema de Postgres por empresa | Migraciones multiplicadas por empresa; Prisma no lo soporta bien |
| Una base de datos por empresa | Coste y operación desproporcionados para un piloto |
| Row Level Security (RLS) de Postgres desde el inicio | Más robusto, pero complica Prisma y las conexiones serverless. Queda como endurecimiento futuro |

## Consecuencias

- Positivas: un solo esquema y una sola migración; consultas globales sencillas para el superadmin y el monitoreo.
- Negativas o riesgos:
  - Un olvido del filtro filtra datos entre empresas. Se mitiga con la capa común, con revisión de código y con pruebas de aislamiento: RIKDP-173 (HU30-T03) y RIKDP-265 (PT5 · IDOR).
  - Una empresa con mucho volumen afecta al rendimiento de las demás; se acepta en el piloto.
