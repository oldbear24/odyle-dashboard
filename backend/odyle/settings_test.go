package odyle

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestCachedSettingsFollowEveryChange(t *testing.T) {
	app := newTestApp(t)
	perCube := func() int64 { return readSettings(app).OdylePerCube }
	if got := perCube(); got != 40 {
		t.Fatalf("default Odyle per cube is %d", got)
	}
	// The Game settings page.
	if _, err := writeSettings(app, body{"odylePerCube": float64(55)}); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 55 {
		t.Fatalf("after saving the settings: %d", got)
	}
	// A superuser editing the record under Collections → odyle_settings.
	record := findSettings(app)
	record.Set("odylePerCube", 60)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 60 {
		t.Fatalf("after editing the record: %d", got)
	}
	// A change inside a transaction counts once it commits.
	if err := app.RunInTransaction(func(tx core.App) error {
		r := findSettings(tx)
		r.Set("odylePerCube", 70)
		return tx.Save(r)
	}); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 70 {
		t.Fatalf("after a committed transaction: %d", got)
	}
	// A rolled back change is forgotten, even when an empty cache loaded it inside its
	// transaction.
	rollback := errors.New("rollback")
	if err := app.RunInTransaction(func(tx core.App) error {
		r := findSettings(tx)
		r.Set("odylePerCube", 80)
		if err := tx.Save(r); err != nil {
			return err
		}
		stateOf(tx).settings.drop()
		if got := readSettings(tx).OdylePerCube; got != 80 {
			t.Errorf("loaded inside the transaction: %d", got)
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if got := perCube(); got != 70 {
		t.Fatalf("after a rolled back transaction: %d", got)
	}
	// Without the record the defaults apply again.
	if err := app.Delete(findSettings(app)); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 40 {
		t.Fatalf("without the record: %d", got)
	}
}

func BenchmarkSettings(b *testing.B) {
	app := newTestApp(b)
	b.Run("cached", func(b *testing.B) {
		for b.Loop() {
			readSettings(app)
		}
	})
	b.Run("record", func(b *testing.B) {
		for b.Loop() {
			loadSettings(app)
		}
	})
}
