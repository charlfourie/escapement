import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('database upgrade', () => {
  it('seeds the movement library from existing watches when upgrading from v1', async () => {
    // A v1 database as the first release created it.
    const old = new Dexie('escapement');
    old.version(1).stores({ watches: 'id, name, updatedAt', measurements: 'id, watchId, takenAt, [watchId+takenAt]' });
    await old.table('watches').bulkPut([
      { id: 'a', name: 'Bell-Matic', brand: 'Seiko', reference: '', caliber: 'Cal. 4006A', bph: 19800, liftAngle: 52, purchaseDate: '', lastService: '', notes: '', photo: null, createdAt: 1, updatedAt: 1 },
      { id: 'b', name: 'Another Bell-Matic', brand: 'Seiko', reference: '', caliber: '4006a', bph: null, liftAngle: 52, purchaseDate: '', lastService: '', notes: '', photo: null, createdAt: 1, updatedAt: 1 },
      { id: 'c', name: 'Unknown', brand: '', reference: '', caliber: '', bph: null, liftAngle: 52, purchaseDate: '', lastService: '', notes: '', photo: null, createdAt: 1, updatedAt: 1 },
    ]);
    old.close();

    const { db, upsertMovement } = await import('../src/db');
    const movements = await db.movements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ id: '4006a', caliber: 'Cal. 4006A', maker: 'Seiko', bph: 19800 });
    expect(await db.watches.count()).toBe(3);

    // upsert fills only empty specs
    await upsertMovement('4006A', { bph: 21600, jewels: 21, size: '27 mm' });
    expect(await db.movements.get('4006a')).toMatchObject({ bph: 19800, jewels: 21, size: '27 mm' });
  });
});
