"use strict";

const fs = require('fs');
const { join, dirname } = require('path');

var express = require('express');
var router = express.Router();

const formulajs = require('@formulajs/formulajs');
global.SUM = formulajs.SUM;

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

//set a consolidation facet
quotes.consolidate(consolidation);

/* GET quotes listing. */
router.get('/', function(req, res, next) {

  //Set the default facet references from the query string
  quotes.setDefaultReferences(function () {

      this.average_steel_cost_m2     = 0.2;
      this.manufacturing_cost_per_m2 = +req.query.manufacturing_cost_per_m2;
      this.low_margin_threshold      = +req.query.low_margin_threshold;
  });

  quotes.setConsolidationReferences(function (uses) {

      this.low_margin_threshold = +req.query.low_margin_threshold;
  });  
  
  let tables = new Map(),
      folder = join(appDir, 'data');

  const dir = fs.opendirSync(folder);

  let dirent;

  //read each quote into a table and calculate
  while ((dirent = dir.readSync()) !== null) {

    let table = quotes.createTable();

    table.load( JSON.parse(fs.readFileSync( join(dirent.parentPath, dirent.name), 'utf8')) );
    tables.set(dirent.name, table);
  }

  dir.closeSync();

  quotes.tables().calculate();  

  let response = [...tables.entries()].map(([k, v]) => (console.log(k,v),{
        name         : k, 
        cost         : v.total_cost,
        offer        : v.total_offer,
        profit       : v.profit,
        gross_margin : v.gross_margin,
        low_margin   : v.low_margin_warning
    }));

    response.push({
      name: 'TOTAL',
        cost         : quotes.total_cost,
        offer        : quotes.total_offer,
        profit       : quotes.profit,
        gross_margin : quotes.gross_margin,
        low_margin   : quotes.low_margin_warning
    })

  res.send(response);
});

module.exports = router;
