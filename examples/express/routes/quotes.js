const fs = require('fs');
const { join, dirname } = require('path');

var express = require('express');
var router = express.Router();

const appDir    = dirname(dirname(require.main.filename));
const libDir    = join(appDir, '..', '..');
const facetsDir = join(libDir, 'examples/js/examples/facets');

//the library
const { defineStack, createTable } = require( join(libDir, 'nosheet.mjs') );

//the facets
const { default: raw_materials } = require( join(facetsDir, 'raw_materials.mjs') );
const { default: lineitems }     = require( join(facetsDir, 'lineitems.mjs') );
const { default: gross_margin }  = require( join(facetsDir, 'gross_margin.mjs') );
const { default: consolidation } = require( join(facetsDir, 'consolidation.mjs') );

const quotes = defineStack('item', 'steel_m2', 'unit_offer', 'quantity');

//set the facets used by the stack
quotes.addFacets(raw_materials, lineitems, gross_margin);      

/* GET quotes listing. */
router.get('/', function(req, res, next) {

  let response = [],
      folder = join(appDir, 'data');

  const dir = fs.opendirSync(folder);

  let dirent;

  while ((dirent = dir.readSync()) !== null) {

    let table = quotes.createTable(dirent.name);
    table.load(  JSON.parse(fs.readFileSync( join(dirent.parentPath,dirent.name), 'utf8')) );
    table.calculate();

    response.push({
          name         : dirent.name,
          cost         : table.total_cost,
          offer        : table.total_offer,
          profit       : table.profit, 
          gross_margin : table.gross_margin,
          low_margin   : table.low_margin_warning
    })
  }

  dir.closeSync();

  res.send(response);
});

module.exports = router;
