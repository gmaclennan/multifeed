var test = require('tape')
var hypercore = require('hypercore')
var multifeed = require('..')
var ram = require('random-access-memory')
var tmp = require('tmp').tmpNameSync
var rimraf = require('rimraf')

test('no feeds', function (t) {
  var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

  t.deepEquals(multi.feeds(), [])
  t.end()
})

test('create writer', function (t) {
  t.plan(5)

  var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

  multi.writer(function (err, w) {
    t.error(err)
    w.append('foo', function (err) {
      t.error(err)
      w.get(0, function (err, data) {
        t.error(err)
        t.equals(data.toString(), 'foo')
        t.deepEquals(multi.feeds(), [w])
      })
    })
  })
})

test('get feed by key', function (t) {
  t.plan(3)

  var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

  multi.writer(function (err, w) {
    t.error(err, 'valid writer created')
    var feed = multi.feed(w.key)
    t.deepEquals(feed, w, 'writer is the same as retrieved feed (buffer key)')
    feed = multi.feed(w.key.toString('hex'))
    t.deepEquals(feed, w, 'writer is the same as retrieved feed (hex key)')
  })
})

test('get localfeed by name', function (t) {
  t.plan(3)

  var multi = multifeed(hypercore, ram, { valueEncoding: 'json' })

  multi.writer('bob', function (err, w) {
    t.error(err, 'valid writer created')
    multi.writer('bob', function (err, w2) {
      t.error(err, 'valid writer retrieved')
      t.deepEquals(w2, w, 'writer is the same as retrieved feed')
    })
  })
})

test('replicate two multifeeds', function (t) {
  t.plan(22)

  var m1 = multifeed(hypercore, ram, { valueEncoding: 'json' })
  var m2 = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var feedEvents1 = 0
  var feedEvents2 = 0
  m1.on('feed', function (feed, name) {
    t.equals(name, String(feedEvents1))
    feedEvents1++
  })
  m2.on('feed', function (feed, name) {
    t.equals(name, String(feedEvents2))
    feedEvents2++
  })

  function setup (m, buf, cb) {
    m.writer(function (err, w) {
      t.error(err)
      w.append(buf, function (err) {
        t.error(err)
        w.get(0, function (err, data) {
          t.error(err)
          t.equals(data, buf)
          t.deepEquals(m.feeds(), [w])
          cb()
        })
      })
    })
  }

  setup(m1, 'foo', function () {
    setup(m2, 'bar', function () {
      var r = m1.replicate()
      r.pipe(m2.replicate()).pipe(r)
        .once('end', check)
    })
  })

  function check () {
    t.equals(m1.feeds().length, 2)
    t.equals(m2.feeds().length, 2)
    m1.feeds()[1].get(0, function (err, data) {
      t.error(err)
      t.equals(data, 'bar')
    })
    m2.feeds()[1].get(0, function (err, data) {
      t.error(err)
      t.equals(data, 'foo')
    })
    t.equals(feedEvents1, 2)
    t.equals(feedEvents2, 2)
  }
})

test('live replicate two multifeeds', function (t) {
  t.plan(22)

  var m1 = multifeed(hypercore, ram, { valueEncoding: 'json' })
  var m2 = multifeed(hypercore, ram, { valueEncoding: 'json' })

  var feedEvents1 = 0
  var feedEvents2 = 0
  m1.on('feed', function (feed, name) {
    t.equals(name, String(feedEvents1))
    feedEvents1++
  })
  m2.on('feed', function (feed, name) {
    t.equals(name, String(feedEvents2))
    feedEvents2++
  })

  function setup (m, buf, cb) {
    m.writer(function (err, w) {
      t.error(err)
      w.append(buf, function (err) {
        t.error(err)
        w.get(0, function (err, data) {
          t.error(err)
          t.equals(data, buf)
          t.deepEquals(m.feeds(), [w])
          cb()
        })
      })
    })
  }

  setup(m1, 'foo', function () {
    setup(m2, 'bar', function () {
      var r = m1.replicate({live:true})
      r.pipe(m2.replicate({live:true})).pipe(r)
      setTimeout(check, 1000)
    })
  })

  function check () {
    t.equals(m1.feeds().length, 2)
    t.equals(m2.feeds().length, 2)
    m1.feeds()[1].get(0, function (err, data) {
      t.error(err)
      t.equals(data, 'bar')
    })
    m2.feeds()[1].get(0, function (err, data) {
      t.error(err)
      t.equals(data, 'foo')
    })
    t.equals(feedEvents1, 2)
    t.equals(feedEvents2, 2)
  }
})

test('get localfeed by name across disk loads', function (t) {
  t.plan(5)

  var storage = tmp()
  var multi = multifeed(hypercore, storage, { valueEncoding: 'json' })

  multi.writer('minuette', function (err, w) {
    t.error(err)
    t.ok(w.key)

    multi.close(function () {
      var multi2 = multifeed(hypercore, storage, { valueEncoding: 'json' })
      multi2.writer('minuette', function (err, w2) {
        t.error(err)
        t.ok(w.key)
        t.deepEquals(w2.key, w.key, 'keys match')
      })
    })
  })
})

test('close', function (t) {
  var storage = tmp()
  var multi = multifeed(hypercore, storage, { valueEncoding: 'json' })

  multi.writer('minuette', function (err, w) {
    t.error(err)

    multi.close(function () {
      t.deepEquals(multi.feeds(), [], 'no feeds present')
      t.equals(multi.closed, true)
      rimraf(storage, function (err) {
        t.error(err, 'Deleted folder without error')
        t.end()
      })
    })
  })
})

test('close after double-open', function (t) {
  var storage = tmp()

  openWriteClose(function (err) {
    t.error(err)
    openWriteClose(function (err) {
      t.error(err)
      rimraf(storage, function (err) {
        t.error(err, 'Deleted folder without error')
        t.end()
      })
    })
  })

  function openWriteClose (cb) {
    var multi = multifeed(hypercore, storage, { valueEncoding: 'json' })
    multi.writer('minuette', function (err, w) {
      t.error(err)
      w.append({type: 'node'}, function (err) {
        t.error(err)
        multi.close(cb)
      })
    })
  }
})
