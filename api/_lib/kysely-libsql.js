// Better Auth når databasen gennem Kysely. Denne dialekt lader Kysely bruge appens libSQL-klient
// (api/_lib/db.js), uden pakken @libsql/kysely-libsql og dens gamle klient. Hentet fra
// MadAssistent og Rutinee (der skrevet i TypeScript).
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely'

export class LibsqlDialect {
  #client

  constructor(client) {
    this.#client = client
  }

  createAdapter() {
    return new SqliteAdapter()
  }

  createDriver() {
    return new LibsqlDriver(this.#client)
  }

  createIntrospector(db) {
    return new SqliteIntrospector(db)
  }

  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
}

class LibsqlDriver {
  #client

  constructor(client) {
    this.#client = client
  }

  async init() {}

  async acquireConnection() {
    return new LibsqlConnection(this.#client)
  }

  async beginTransaction(connection) {
    await connection.begin()
  }

  async commitTransaction(connection) {
    await connection.commit()
  }

  async rollbackTransaction(connection) {
    await connection.rollback()
  }

  async releaseConnection() {}

  // Klienten hører til db.js, som holder den åben.
  async destroy() {}
}

class LibsqlConnection {
  #client
  #transaction

  constructor(client) {
    this.#client = client
  }

  async executeQuery(query) {
    const result = await (this.#transaction ?? this.#client).execute({
      sql: query.sql,
      args: query.parameters,
    })
    return {
      rows: result.rows,
      numAffectedRows: BigInt(result.rowsAffected),
      ...(result.lastInsertRowid === undefined ? {} : { insertId: result.lastInsertRowid }),
    }
  }

  // eslint-disable-next-line require-yield -- Kysely vil have en generator; libSQL kan ikke streame
  async *streamQuery() {
    throw new Error("libSQL can't stream results")
  }

  async begin() {
    if (this.#transaction) throw new Error('A transaction is already open')
    this.#transaction = await this.#client.transaction('write')
  }

  async commit() {
    if (!this.#transaction) throw new Error('No transaction to commit')
    await this.#transaction.commit()
    this.#transaction = undefined
  }

  async rollback() {
    if (!this.#transaction) throw new Error('No transaction to roll back')
    await this.#transaction.rollback()
    this.#transaction = undefined
  }
}
