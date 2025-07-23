"use strict";
/* 2025-07-22 14:22:22.1665556 +0100 BST m=+0.090199701 */


export { TagCloud };

class TagCloud {

    #tags = new Map(); //map of sets
    #ids  = new Map(); //map of sets   

    /**
     * Return if true if id is present
     * 
     * @param {*} unique_id 
     * @returns 
     */
    hasId(unique_id){

        return this.#ids.has(unique_id);
    }

    /**
     * Return true if tag is present
     * 
     * @param {*} tag 
     * @returns 
     */
    hasTag(tag){

        return this.#tags.has(tag);
    }

    /**
     * Add a new id to the tag cloud, if the unique id already has tags then the new tags are added
     * 
     * @param {*} tags 
     * @param {*} unique_id 
     */
    add(tags, unique_id){

        //init and add tags to tag cloud
        for(const tag of tags){

            if( !this.hasTag(tag) ){

                this.#tags.set(tag, new Set());
            }

            this.#tags.get(tag).add(unique_id);
        };

        //does this unique id already exist?
        if( this.hasId(unique_id) ){

            tags.forEach( tag => this.#ids.get(unique_id).add(tag) );
        }
        else {

            this.#ids.set(unique_id, new Set(tags));        
        }
    }    

    /**
     * List id's for matching tags
     * List always return ids in the order they were added to the tagCloud
     *  
     * @param  {...any} tags 
     * @returns Iterator
     */
    list(...tags){

        //list all - return map iterator
        if( !tags?.length) return this.#ids.keys();

        //return an iterator that only iterates over the listed tags
        let unique_ids = new Set();

        for(const tag of tags){

            (this.#tags.get(tag)??[]).forEach( id => unique_ids.add(id) );
        };        

        //if the tags supplied returned all the keys - just return the full list of keys (preserving order)
        if( unique_ids.size == this.#ids.size ) return this.#ids.keys();
        
        /*https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/intersection
        The order of elements in the returned set is the same as that of the smaller of this and other.
        As unique_ids will always be smaller than the full set we need to do some additional processing
        */

        return this.#ids.keys().filter( sheet_id => unique_ids.has(sheet_id) );
    }

    /**
     * Replace or add
     * 
     * @param {*} unique_id 
     * @param {*} tags 
     * @returns Set of removed tags or true if unique_id was added
     */
    upsert(unique_id, tags){

        if( !this.hasId(unique_id) ){

            this.add(tags, unique_id);

            return true;
        }

        return this.update(unique_id, tags);
    }

    /**
     * Replace all a unique ids tags with new tags
     * 
     * @param {*} unique_id 
     * @param {*} tags 
     * @returns deleted tags
     */
    update(unique_id, tags){

        if( !this.hasId(unique_id) ){

            throw new Error(`The unique id '${unique_id}' does not exist`);
        }

        let previous_tags = this.#ids.get(unique_id).difference(new Set(tags));

        this.remove(unique_id);
        this.add(tags, unique_id);

        return previous_tags;
    }

    /**
     * Remove the unique id and it's tags
     * 
     * @param {*} unique_id 
     * @returns tags associated with the unique_id
     */
    remove(unique_id){

        let tags = this.#ids.get(unique_id);

        this.#ids.delete(unique_id);

        //remove orphaned tags
        for(const tag of tags){

            this.#tags.get(tag).delete( unique_id );

            //if tag entry is empty - remove it from the tag cloud
            if( !this.#tags.get(tag).size ){

                this.#tags.delete(tag);
            }
        }        

        return tags;
    }
}

export { createTable, defineStack };

/**
 * simple array validation
 * @param {*} arr 
 */
function validateArray(arr){

    if( arr && !Array.isArray(arr) ){
        throw new TypeError("Array expected");
    }
}

/**
 * 
 * @returns TableFactory
 */
function defineStack(...data_columns){
    
    return TableFactory.create(data_columns);
}

/**
 * Create a table instance
 * 
 * @returns Table
 */
function createTable(data_columns, ...facets){
   
    validateArray(data_columns);

    let tableFactory = TableFactory.create(data_columns);

    tableFactory.addFacets(...facets);

    return tableFactory.createTable();
}

const   noop           = _ => {},
        allTagsSymbol  = Symbol('all-tags'),
        //hidden properties
        rowUIDprop     = Symbol('uid'),        
        tablesProp     = Symbol('tags');

/**
 * Test the property to see if it is present in the standard built-in Object.prototype
 * 
 * @param {*} p 
 * @returns 
 */
function isStdObjectProp(p){

    return !!Object.prototype[p];
}

/**
 * Test the property to see if it is a Symbol or is present in the standard built-in Object.prototype
 * 
 * @param {*} p 
 * @returns 
 */
function isStdObjectPropOrSymbol(p){

    if( 'symbol' === typeof p ) return true;

    return isStdObjectProp(p);
}

/**
 * 
 * @param {*} fn 
 * @return {boolean}
 */
function isFunction(fn){

    return typeof fn === 'function';
}

/**
 * 
 * @param {*} fn 
 * @return {boolean}
 */
function isArrowFunction(fn){

    return isFunction(fn) && undefined === fn.prototype;
}

/**
 * Check if object is iterable
 * @param {*} obj 
 * @returns boolean
 */
function isIterable(obj) {

    // checks for null and undefined
    if (obj == null) {
        return false;
    }

    return typeof obj[Symbol.iterator] === 'function';
}

const registration_handler = {

    get: (obj, prop) => { throw new Error(`${prop} getter is not allowed in this context`); },
    set: (obj, prop, fn) => {

        if( typeof fn !== 'function' || undefined !== fn.prototype ){

            throw new Error(`${prop} is not an arrow function`);                
        }

        if( obj.hasFunction(prop) ){

            throw new Error(`${prop} is already defined`);                
        }

        obj.registerFunction(prop);

        return true;
    }
}

function getRegistrationHandler(registrar){
    return new Proxy(registrar, registration_handler);
}

//atrribution: https://gist.github.com/gordonbrander/1f495be55db2a54554eebd3ab8c7a8a5
const isObject = thing => thing != null && typeof thing === "object";

class ReadOnlyProxyWriteError extends Error {};

const ReadOnlyProxyDescriptor = {
  get: (target, key) => {
    let value = target[key]
    if (!isObject(value)) {
      return value
    }
    return readonly(value)
  },
  set: (target, key) => {
    throw new ReadOnlyProxyWriteError('Cannot write on read-only proxy')
  },
  deleteProperty: (target, key) => {
    throw new ReadOnlyProxyWriteError('Cannot delete on read-only proxy')
  }
};

// Create a read-only proxy over an object.
// Sub-properties that are objects also return read-only proxies.
const readonly = obj => new Proxy(obj, ReadOnlyProxyDescriptor);

/**
 * The TableFactory
 */
class TableFactory {

    static #factories = new Map();

    static #ident = Symbol('ident');

    get ident(){
        return TableFactory.#ident;
    }

    static isTypeOfMe(obj){
        
        return TableFactory.#ident === obj.ident;
    }

    static create(data_columns){

        let parent_scope = new TableFactory(data_columns);

        //Return a proxy to enable dynamic properties
        return new Proxy(
                    parent_scope,
                    {
                        get: (target, prop, receiver) => { 

                            if( parent_scope.#consolidation_aggregates.has(prop) ){

                                return parent_scope.#consolidation_aggregates.get(prop);
                            }

                            const value = target[prop];

                            if (value instanceof Function) {
                              return function (...args) {
            
                                return value.apply(this === receiver ? target : this, args);
                              };
                            }
    
                            return value;
                        }
                    }                    
               );
    }

    #id;
    #table_counter  = 0;
    #tag_cloud      = new TagCloud();    
    #table_interfaces = new Map(/*[sheet_id, [table, proxy table_instance]]*/);

    //the dataset column names (defined by data_columns and row function names)
    //setup in the constructor
    #num_data_columns;
    #column_names;
    #column_indexes;  

    //tables formulas
    #aggregates  = new Map();
    #facets      = [];

    //references
    #reference_facets = new Map(/* facet => Map( ref => value) */);
    #default_reference_facet; //a function

    //dependencies
    #dependencies = new Set();

    //consolidation
    #consolidation_aggregates = new Map();
    #consolidation_aggregate_indexes = new Map();
    #current_aggregate_index;

    #consolidation_reference_facet; //Function    
    #consolidation_references = new Map();
    #consolidation_reference_handles = new Map();
    
    #consolidators = [];

    static #throw_invalid_aggregate_error = (prop) => {throw new Error(`Invalid consolidation aggregate: '${prop}'`);};
    static #throw_invalid_reference_error = (prop) => {throw new Error(`Invalid consolidation reference: '${prop}'`);};    

    #hooks = new Map([
        ['beforeConsolidation', []],
        ['afterConsolidation',  []],
    ]);

    constructor(data_columns = []){
        
        this.#id = Symbol(`s${TableFactory.#factories.size + 1}`);

        this.#num_data_columns = data_columns.length;
        this.#column_names   = data_columns.slice();
        this.#column_indexes = new Map( data_columns.map( v => [v, data_columns.indexOf(v) ]) );

        TableFactory.#factories.set(this.#id, this);
    }

    id() { return this.#id; }

    /**
     * Create a new table instance
     * @param  {...any} tags 
     * @returns 
     */
    createTable(...tags) {

        let table_id      = Symbol(`${this.#id.description}.T${++this.#table_counter}`),
            table         = new Table(table_id, this),
            proxied_table = table.publicInterface;

        this.#table_interfaces.set(table_id, {table, proxied_table, sheet:this.#id});
        this.#tag_cloud.add([...tags, table_id], table_id);

        return proxied_table;
    }    

    /**
     * Remove table references should only be called
     * via Table::detach interface
     * 
     * @param {*} table_id 
     */
    detachTable(table_id, consolidate){

        //remove from the internal table list
        this.#table_interfaces.delete(table_id);

        //remove from tag cloud
        this.#tag_cloud.remove(table_id);

        // remove any reference facets with a reference_count of zero
        this.#reference_facets.keys().filter( facet => !facet.reference_count ).forEach( f => this.#reference_facets.delete(f) );

        if( consolidate) {

            this.doConsolidation();
        }
    }

    /**
     * 
     * @param {*} facet 
     */
    setDefaultReferences(facet){

        if( isArrowFunction(facet) ){

            throw new Error('Arrow functions are not supported');
        }            

        //we need this to prevent this facets from being cleared when tables are detached
        facet.reference_count = 1;
        facet.is_default = true;

        this.#reference_facets.set(facet, this.#registerReferences(facet));
        this.#default_reference_facet = facet;
    }

    /**
     * Return the default reference values overwritten by the supplied facet 
     * (which must have been registered)
     * 
     * @param {*} facet 
     * @returns {Map}
     */
    resolveReferences(facet){
/*
        console.log({
            "default" : this.#default_reference_facet,
            "default_props": this.#reference_facets.get(this.#default_reference_facet),
            "facet_props":this.#reference_facets.get(facet)
        });
*/
        return new Map( [
                    ...this.#reference_facets.get(this.#default_reference_facet)??new Map(), 
                    ...this.#reference_facets.get(facet)??new Map()
                ] );
    }

    /**
     * Returns a single table matching the tags, if multiple tables exist then an excpetion is thrown
     * @param  {...any} tags 
     * @returns 
     */
    getUniqueTable(...tags){

        let tables = [...[...this.#tag_cloud.list(...tags)].map( id => this.#table_interfaces.get(id).proxied_table )];

        if( tables.length > 1){
            throw new Exception(`Multiple tables match tags: ${tags}`);
        }

        return tables.pop();
    }

    /**
     * Return an iterator for the tables matching the tags
     * The tables are returned in the order they were created
     * 
     * @param  {...any} tags 
     */
    tables(...tags){

        let parent_scope = this;

        const tableIterator = {

            /**
             * Return attributes in the order defined by the names passed
             * @param  {...any} names 
             * @returns 
             */
            aggregates(...names){

                let tables = [...parent_scope.#tag_cloud.list(...tags)].map( id => parent_scope.#table_interfaces.get(id).table );

                //if only one aggregate is requested reutrn that as a single array
                if( 1 == names.length ){

                    return tables.map(t => t.getAttribute(names[0]));
                }

                //return all aggregates
                if( !names.length ){

                    names = parent_scope.#aggregates.keys();
                }

                return  {
                        *[Symbol.iterator]() {

                            for(const aggregate of names ){

                                yield tables.map(t => t.getAttribute(aggregate));
                            }
                        }
                    };
            },

            setReferences(facet){

                if( isArrowFunction(facet) ){

                    throw new Error('Arrow functions are not supported');
                }            
        
                facet.reference_count = 0;

                //register reference facets and their dependencies
                parent_scope.#reference_facets.set(facet, parent_scope.#registerReferences(facet));

                //set table reference facets
                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table._setReferenceFacet(facet) );
            },

            /**
             * Get a single reference handle for a facets reference for the matching tables
             * @param {*} name 
             * @param {*} initial_value
             */
            getReferenceHandle(name, initial_value){

                //check is reference

                /**
                 * Proxy handler that provides access to a facet reference
                 * Forces a table calculation when new value is set
                 */
                let ReferenceReferenceHandler = {

                    ['valueOf'](){ return Reflect.get(target, 'value'); },
                    set: (target, prop, value) => {

                        Reflect.set(target, prop, value);

                        if( 'value' == prop ){

                            //set table reference facets
                            parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table._setReferenceHandleValue(name, value) );

                            this.calculate();                            
                        }

                        return true;
                    }
                };

                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table._setReferenceHandleValue(name, initial_value) );
                
                //return reference proxy
                return  new Proxy(
                            {value: initial_value },
                            ReferenceReferenceHandler
                        );
            }      ,

            beforeCalculate(...fns){

                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table.beforeCalculate(...fns) );                
            },

            calculate(){

                //console.log(`calculating ${parent_scope.#id.description}`);
                parent_scope.updateReferences();                        
                //before calcs
                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table.executeFacets() );
                //after calcs
                parent_scope.doConsolidation();                        
            },

            afterCalculate(...fns){

                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table.afterCalculate(...fns) );                
            },

            detach(){

                parent_scope.#tag_cloud.list(...tags).forEach( id => parent_scope.#table_interfaces.get(id).table.detach(id, false) );                
                parent_scope.doConsolidation();
            },

            [Symbol.iterator]() {

                let table_ids = parent_scope.#tag_cloud.list(...tags);

                return {

                    next() {

                        let next = table_ids.next();

                        if( !next.done ){

                            next.value = parent_scope.#table_interfaces.get(next.value).proxied_table;
                        }

                        return next;
                    },
                    return() {
                        return { done: true };
                    },
                };
              },
        };

        //return the iterator in a proxy so we can request attributes as properties
        return new Proxy(
                    tableIterator,
                    {
                        get: (target, prop, receiver) => { 

                            if( parent_scope.#aggregates.has(prop) ){

                                return target.aggregates(prop);
                            }

                            return Reflect.get(target, prop, receiver);
                        }
                    }
                );            
    }

    /**
     * Return a table instance identified by it's internal id.
     * 
     * @param  {Symbol} sheet_id
     */
    getTableByInternalId(sheet_id){

        return this.#table_interfaces.get(sheet_id)?.proxied_table;
    }

    /**
     * Return the facet functions
     * @returns 
     */
    get facets(){

        return this.#facets.values();
    }

    /**
     * Return the names of the data row columns
     * @returns 
     */
    get dataColumnNames(){

        return this.#column_names.slice(0, this.#num_data_columns);
    }

    /**
     * Return the names of the row columns
     * @returns 
     */
    get columnNames(){

        return this.#column_names.values();
    }

    /**
     * Return the names of the row columns
     * @returns 
     */
    get calculatedColumnNames(){

        return this.#column_names.slice(this.#num_data_columns);
    }    

    get aggregateNames(){

        return this.#aggregates.keys();
    }

    /**
     * 
     */
    hasColumn(column_name){

        return this.#column_indexes.has(column_name);
    }

    columnIndex(column_name){

        return this.#column_indexes.get(column_name);
    }

    hasAggregate(aggregate){

        return this.#aggregates.has(aggregate);
    }

    aggregateIndex(aggregate){

        return this.#aggregates.get(aggregate);
    }

    /**
     * @returns {Map}
     */
    get consolidationAggregates(){

        return new Map(this.#consolidation_aggregates);
    }

    #table_registrar = {
        hasFunction      : prop => this.#aggregates.has(prop),
        registerFunction : prop => this.#aggregates.set(prop, this.#aggregates.size),
    };

    #row_registrar   = {
        hasFunction      : prop => this.#column_names.indexOf(prop) !== -1,
        registerFunction : prop => {
            this.#column_names.push(prop);
            this.#column_indexes.set(prop, this.#column_indexes.size);
        },
    };

    #registration_bind = new Proxy({},{get: (target, prop, receiver) => { 

                                                if(prop === 'facetInterfaces') return _ => [];
                                                
                                                throw new Error('__this__ is not valid outside of a facet row or aggregate function')
                                            }
                                        });

    addFacets(...facets_to_use) {

        let table_registrator = getRegistrationHandler(this.#table_registrar),
            row_registrator   = getRegistrationHandler(this.#row_registrar);

        //loop the facet constructors to register the facet functions
        for( const facet_constructor of facets_to_use ){

            if( isArrowFunction(facet_constructor) ){

                throw new Error('Arrow functions are not supported');
            }

            facet_constructor.bind(this.#registration_bind)(table_registrator, row_registrator, Object.freeze({}));
        }                   

        //all facet column and aggregate functon names should now have been registered

        //store the facet functions
        this.#facets.push(...facets_to_use); 
    }

    #consolidation_aggregate_registrar = {
        hasFunction      : prop => this.#consolidation_aggregate_indexes.has(prop),
        registerFunction : prop => this.#consolidation_aggregate_indexes.set(prop, this.#consolidation_aggregate_indexes.size),
    };

    /**
     * Consolidate all tables with the listed tags.
     * This happens after a calculation event
     * 
     * @param {*} tags 
     * @param {*} facets 
     * @returns Object
     */
    consolidate(tags = [], ...facets) {

        if( typeof tags === 'function' ){

            facets.unshift(tags);
            tags = [allTagsSymbol];
        }

        let registrator = getRegistrationHandler(this.#consolidation_aggregate_registrar);

        //loop the facet constructors to register the facet functions
        for( const fn of facets ){

            fn.bind(registrator, Object.freeze({}))();
        }                   

        //all consolidation names should now have been registered

        //store the facets
        this.#consolidators.push([tags, facets]);         
    }

    #hasAggregateBeenCalculated(aggregate){
        /*                
        console.log({
            aggregate,
            exists: this.#consolidation_aggregate_indexes.has(aggregate),
            current_index: this.#current_aggregate_index,
            aggregate_index: this.#consolidation_aggregate_indexes.get(aggregate)
        });
        */
        return  this.#consolidation_aggregate_indexes.has(aggregate)
                &&
                this.#current_aggregate_index >= (this.#consolidation_aggregate_indexes.get(aggregate)??Number.MAX_SAFE_INTEGER);
    }

    #consolidation_handler = {
        get: (target, prop) => { 
            //console.log(`${this.#id.description}#consolidation_aggregates.get ${prop} (${this.#current_aggregate_index})`);                        

            //is prop an aggregate name
            if( this.#hasAggregateBeenCalculated(prop) ){

                return this.#consolidation_aggregates.get(prop);
            }

            if( Reflect.has(target, prop)){

                return Reflect.get(target, prop, receiver);
            }

            TableFactory.#throw_invalid_aggregate_error(prop);            
        },        
        set: (target, prop, fn) => {    
            //console.log(`${this.#id.description}#consolidation_aggregates.set ${prop} (${this.#current_aggregate_index})`);                        

            this.#current_aggregate_index++;            
            this.#consolidation_aggregates.set(prop, fn() );

            return true;
        }
    };

    #consolidation_proxy = new Proxy({}, this.#consolidation_handler);    

    #factory_tables_handler = {
        get: (target, prop, receiver) => { 

            if( 'symbol' === typeof prop ){

                return Reflect.get(target, prop, receiver);
            }

            //check for aggregate
            if( this.hasAggregate(prop) ){

                return target[tablesProp].map( t => t[prop] );
            }

            return Reflect.get(target, prop, receiver);
        },

        //treat this as a select and record the fluent method calls to be applied to the table object        
        apply: (target, thisArg, argumentsList) => {

            //validate columns
            let invalid_columns = argumentsList.filter( n => !this.hasColumn(n) ); 

            if( invalid_columns.length ){
                throw new Error(`The following columns are not defined: ${invalid_columns}`);
            }

            let columnIndex = (column) => this.columnIndex(column),
                where       = [],
                from        = new Set();

            return {

                //map 
                ordered_columns : argumentsList.toSorted( (a,b) => columnIndex(a) - columnIndex(b) ),
                columns: new Map( argumentsList.reduce((acc,curr)=> ([...acc, [curr, acc.length ]]),[]) ),
                
                //return true if there are no results
                isEmpty(){
    
                    for(const n of this){
                        return false;
                    }
    
                    return true;
                },
                
                *[Symbol.iterator]() {
    
                    //once iteration begins - remove the fluent construction methods
                    delete this.where;
                    delete this.from;

                    for(const t of target[tablesProp]){
                        
                        yield [...t.select(...argumentsList).from(...from).where(...where)];
                    }
                },
                from(...populationsOfInterest) {
    
                    populationsOfInterest.forEach( from.add, from );
                    return this;
                },
                where(...filterFunctions) {
    
                    where.push(...filterFunctions);
                    return this;
                },
            }
        }
    };

    #consolidation_reference_handler = {
        get: (target, prop, receiver) => { 
/*
            console.log({
                id: this.#id,
                prop,
                facet: this.#consolidation_reference_facet,
                cahced: facet: this.#consolidation_references,
                value: this.#consolidation_references?.get(prop)
            });
*/
            //first check for a local reference handle
            if( this.#consolidation_reference_handles.has(prop) ){

                return this.#consolidation_reference_handles.get(prop);
            }

            return this.#consolidation_references?.get(prop) ?? TableFactory.#throw_invalid_reference_error(prop);            
        }
    };

    #consolidation_reference_proxy = Object.preventExtensions( new Proxy({}, this.#consolidation_reference_handler) );    

    #processConsolidationFacets(tags, facets){

        //define fn using a self execuing anon. arrow function
        let fn    = (_ => {
                        let f = (...args) => {};
                        
                        f[tablesProp] = [...this.tables(...tags)];

                        return f;
                    })(),
            table_proxy = new Proxy(fn, this.#factory_tables_handler);

        //execute each facet
        facets.forEach( f => f.bind(this.#consolidation_proxy, table_proxy, this.#consolidation_reference_proxy)() );
    }

    doConsolidation(){

        this.updateConsolidationReferences();

        this.#executeHooks('beforeConsolidation');

        //run consolidation fns
        this.#current_aggregate_index = -1;

        try{

            this.#consolidators.forEach( ([tags, facets]) => {

                this.#processConsolidationFacets( 
                                                    tags[0] === allTagsSymbol ? [] : tags,
                                                    facets
                                                );
            });
        }
        finally {
            this.#current_aggregate_index = undefined;
        }

        this.#executeHooks('afterConsolidation');

        //force recalculation of dependents
        this.#dependencies.values().forEach( factory => factory.tables().calculate() );

        this.#executeHooks('afterDependents');
    }

   /**
     * 
     */
    updateConsolidationReferences(){

        //console.log(`updateReferences ${this.#id.description}`);

        //if there is no consolidation reference facet - exit
        if( !this.#consolidation_reference_facet ){

            return;
        }

        let handler = {
                set : (obj, prop, val) => {
                        
                    obj.set(prop, val);
                    return true;
                },
                get: (target, prop) => { 
        
                    throw new Error('Invalid operation');
                }
            };
    
        //process all the reference facet
        let references = new Map(),
            proxy      = new Proxy(references, handler);

        this.#consolidation_reference_facet.bind(proxy)(obj => this.#handleConsolidationAggregateProperties(obj) );

        //updated cached references
        this.#consolidation_references = references;
    }   

    setConsolidationReferences(facet){

        if( isArrowFunction(facet) ){

            throw new Error('Arrow functions are not supported');
        }            

        //register reference facets and their dependencies
        this.#consolidation_reference_facet = facet;
        this.#consolidation_references = this.#registerReferences(facet);
    }    

    /**
     * Set the reference handle value
     * @param {*} name 
     * @param {*} value 
     */
    #setConsolidationReferenceHandleValue(name, value){

        this.#consolidation_reference_handles.set(name, value);
    }

    /**
     * Get the reference handle for a facet references
     * @param {*} name 
     * @param {*} initial_value
     */
    getConsolidationReferenceHandle(name, initial_value){

        //check is reference

        /**
         * Proxy handler that provides access to a facet reference
         * Forces a table calculation when new value is set
         */
        let ReferenceReferenceHandler = {

            ['valueOf'](){ return Reflect.get(target, 'value'); },
            set: (target, prop, value) => {

                Reflect.set(target, prop, value);

                if( 'value' == prop ){

                    //also set the value of the reference
                    this.#setConsolidationReferenceHandleValue(name, value);

                    this.doConsolidation();
                }

                return true;
            }
        };

        this.#setConsolidationReferenceHandleValue(name, initial_value);
        
        //return reference proxy
        return  new Proxy(
                    {value: initial_value },
                    ReferenceReferenceHandler
                );
    }

    #executeHooks(hook_name, tags = []){

        (this.#hooks.get(hook_name)??[]).forEach( (fn) => fn() );        
    }

    #setHook(hook_name, callbackFns) {

        this.#hooks.get(hook_name).push(...callbackFns);
    }  

    beforeConsolidation(...fns){

        this.#setHook('beforeConsolidation', fns);
    }

    afterConsolidation(...fns){

        this.#setHook('afterConsolidation', fns);        
    }

    /**
     * 
     * @param {*} sheet_id 
     */
    #getFactoryWithSheetId(sheet_id){

        return TableFactory.#factories.values().find( (obj) => obj.getTableByInternalId(sheet_id) );
    }

    /**
     * Define the references (links to external data) that are used in the facets by this factory
     * 
     * @param {*} tags
     * @param {*} fn 
     * @returns {Set}
     */            
    #registerReferences(facet) {

        let dependencies = new Set(),

        //a map of references name e.g this.ref1 and the the facet it appears in
        references   = new Set();        

        let handler = {
                set : (obj, prop, val) => {
                        
                    obj.add(prop);
                    return true;
                },
                get: (target, prop) => { 
        
                    throw new Error('Invalid operation');
                }
            },
            proxy      = new Proxy(references, handler);            
                        
        //call the callback - this should set up the dependencies
        facet.bind(proxy)( (dependency) => {

            //check is not a table of this factory
            if( this.#table_interfaces.has(dependency.id()) ){
                throw new Error('Self referencing table');
            }

            //check is not __this__ factory
            if( this.#id === dependency.id() ){
                throw new Error('Self referencing sheet');
            }

            //is this a sheet dependency?
            if( TableFactory.isTypeOfMe(dependency) ){

                dependencies.add( dependency );
            }

            //or a table instance dependency ?
            else {
                dependencies.add( this.#getFactoryWithSheetId(dependency.id()) );
            }

            //return something which is effectively a noop
            return Object.freeze(new Proxy({}, {
                get(target, prop, receiver) {
                    return noop;
                },
            }));                
        });

        //add recorded dependencies
        dependencies.values().forEach( sheet => sheet.addDependency( this ) );

        return references;
    }    

    /**
     * 
     * @param {TableFactory} sheet 
     */
    addDependency(sheet){

        //check for circular dependencies
        let nodes   = new Set([this.#id]),
            breadth = new Set( [...this.#dependencies.values().map( sf => sf.id() ), sheet.id()] ),
            last_node = this.#id;

        for(const node of breadth ){

            if( nodes.has(node) ) {
/*
                console.error({
                    Child: node,
                    Parent: last_node
                });
*/                
                throw new Error('Circular reference detected');
            }

            nodes.add( node );
            TableFactory.#factories.get(node).#dependencies.forEach( sf => breadth.add(sf.id()) );
            last_node = node;
        }

        this.#dependencies.add(sheet);
    }

    #reference_consolidation_handler = {
        get: (target, prop, receiver) => { 

            return target[prop];
        }
    };

    /**
     * 
     * @param {*} obj 
     * @returns 
     */
    #handleConsolidationAggregateProperties(obj){

        if( !TableFactory.isTypeOfMe(obj) ){
            return obj;
        }

        return Object.preventExtensions( new Proxy(obj, this.#reference_consolidation_handler) );
    }

    /**
     * 
     */
    updateReferences(){

        //console.log(`updateReferences ${this.#id.description}`);

        let handler = {
                set : (obj, prop, val) => {
                        
                    obj.set(prop, val);
                    return true;
                },
                get: (target, prop) => { 
        
                    throw new Error('Invalid operation');
                }
            };
    
        //process all the reference facets - caching the results
        this.#reference_facets.keys().forEach( facet => {

            //exec the facet gathering the results
            let references = new Map(),
                proxy      = new Proxy(references, handler);

            facet.bind(proxy)(obj => this.#handleConsolidationAggregateProperties(obj) );

            //updated cached references
            this.#reference_facets.set(facet, references);
        });
    }
}

/**
 * Table object
 */
class Table {

    #id;
    #sheet_factory;
    #ticks = 0; //# of calculation events
    #calculating = false;

    #rows       = [];
    #attributes = new Map(); 
    #reference_facet;   //Function
    #reference_handles = new Map();
    #cells = new TableRows(this.#rows);

    //callbacks
    #beforeCalculate = [];
    #afterCalculate  = [];

    //these are only relevent during a calculation
    #current_column_index;
    #current_aggregate_index;

    constructor(id, sheet_factory){

        this.#id = id;
        this.#sheet_factory = sheet_factory;
    }

    id() { return this.#id; }

    ticks() { return this.#ticks; }

    /**
     * Remove any references to this table from it's sheet 
     * so that it can be garbage collected
     */
    detach(consolidate = true){

        if( this.#reference_facet ){

            this.#reference_facet.reference_count--;
        }
        
        this.#sheet_factory.detachTable(this.#id, consolidate);
    }

    /**
     * 
     * @param {*} name 
     * @returns 
     */
    getAttribute(name) {
        return this.#attributes.get(name);
    }

    get publicInterface() {
        
        return new Proxy( this, {
            
                    get: (target, prop, receiver) => {

                        const value = target[prop];

                        if (value instanceof Function) {
                          return function (...args) {
        
                            return value.apply(this === receiver ? target : this, args);
                          };
                        }
        
                        //return the aggregate value
                        return this.#attributes.get(prop);
                    },
                    set: (target, prop, value) => {
                        throw new Error('Tables are read only');
                    }
                });
    }

    #isValidColumnDuringFacetCalculation(column){
/*
        console.log({
            column, 
            exists: this.#sheet_factory.hasColumn(column), 
            current_index: this.#current_column_index,
            column_index: this.#sheet_factory.columnIndex(column)
        });
*/
        return  this.#sheet_factory.hasColumn(column)
                &&
                this.#current_column_index > (this.#sheet_factory.columnIndex(column)??Number.MAX_SAFE_INTEGER);
    }

    #hasAggregateBeenCalculated(aggregate){
        /*
        console.log({
            aggregate,
            exists: this.#sheet_factory.hasAggregate(aggregate),
            current_index: this.#current_aggregate_index,
            aggregate_index: this.#sheet_factory.aggregateIndex(aggregate)
        });
        */
        return  this.#sheet_factory.hasAggregate(aggregate)
                &&
                this.#current_aggregate_index >= (this.#sheet_factory.aggregateIndex(aggregate)??Number.MAX_SAFE_INTEGER);
    }

    static #throw_column_error = (prop) => {throw new Error(`Column '${prop}' doesn\'t exist`);};
    static #throw_invalid_column_error = (prop) => {throw new Error(`Invalid column: '${prop}'`);};
    static #throw_invalid_aggregate_error = (prop) => {throw new Error(`Invalid aggregate: '${prop}'`);};
    static #throw_invalid_reference_error = (prop) => {throw new Error(`Invalid reference: '${prop}'`);};

    //column is only allowed in a facet aggregate definition
    /**
     * Return a single column
     * 
     * @param {*} column_of_interest 
     * @returns 
     */
    columnIterator(column_of_interest = 0){

        return this.columns(column_of_interest);
    }

    column(column_of_interest = 0){
        return [...this.columnIterator(column_of_interest)];
    }

    //column is only allowed in a facet aggregate definition    
    columnsIterator(...columns_of_interest){

        if( !columns_of_interest.length ) return [];

        //check columns of interest have already been calculated
        let bad_columns = columns_of_interest.filter( c => !this.#isValidColumnDuringFacetCalculation(c) );

        if( bad_columns.length ){

            throw new Error(`Invalid columns: ${bad_columns}`);
        }

        return this.select(...columns_of_interest);
    }

    columns(...columns_of_interest){
        return [...this.columnsIterator(...columns_of_interest)];
    }

    //readonly scope
    select(...columns_of_interest){

        //validate columns
        let invalid_columns = columns_of_interest.filter( n => !this.#sheet_factory.hasColumn(n) ); 

        if( invalid_columns.length ){
            throw new Error(`The following columns are not defined: ${invalid_columns}`);
        }

        let columnIndex = (column) => this.#sheet_factory.columnIndex(column),
            parent_scope = this,
            where       = [],
            from        = new Set(),
            symFalse    = Symbol('false'),
            current_select_row_index;

        const select_filter_handler = {

                get: (target, prop, receiver) => { 

                    if( prop === Symbol.toPrimitive ){

                        console.warn("Converting select_filter_proxy to primative.\nPossible causes are not specifiying columns in a where() clause, e.g. select('column').where( v => __v__ == ...)?");
                    }

                    if( isStdObjectPropOrSymbol(prop) ){

                        return Reflect.get(target, prop, receiver);
                    }

                    let index = isNaN(+prop) 
                                ? this.#sheet_factory.columnIndex(prop)
                                : prop;

                    return this.#rows[current_select_row_index][index] ?? Table.#throw_column_error(prop);
                },
            },
            select_filter_proxy = Object.preventExtensions(new Proxy({}, select_filter_handler));
      
        const selectIterator = {

            //map 
            ordered_columns : columns_of_interest.toSorted( (a,b) => columnIndex(a) - columnIndex(b) ),
            columns: new Map( columns_of_interest.reduce((acc,curr)=> ([...acc, [curr, acc.length ]]),[]) ),
            
            //return true if there are no results
            isEmpty(){

                for(const n of this){
                    return false;
                }

                return true;
            },
            
            *[Symbol.iterator]() {

                //once iteration begins - remove the fluent construction methods
                delete this.where;
                delete this.from;

                for(current_select_row_index of parent_scope.#cells.forEachRowIndexInPopulations(...from)){

                    let row_index = current_select_row_index;

                    //run filters until a row is found
                    let result = ! where.length                             //shortcut filter
                                 ? parent_scope.#rows[row_index]            //get the entire row
                                 : where.reduce( 
                                        (a, f) => 

                                            // if the previous filter function has failed
                                            // OR if the current filter function has failed
                                            (a === symFalse || false === f(a))
                                                ? symFalse              // then return our unique 'failed' symbol
                                                : a                     // else return the dataset row proxy
                                        ,                    
                                        select_filter_proxy
                                    );

                    if( result !== symFalse ){

                        //we return parent_scope.#rows[row_index] rather than result to ensure that the dataset has not been manipulated in any way

                        //if no columnsOfInterest have been supplied return the full result array                        
                        if( !columns_of_interest.length ){
                            yield parent_scope.#rows[row_index];
                        }

                        //only one column required
                        else if( 1 === columns_of_interest.length ){

                            yield parent_scope.#rows[row_index][ columnIndex( columns_of_interest[0] ) ];
                        }

                        else {
                            //return subset
                            yield columns_of_interest.reduce( (pv, cv) => ( [...pv, parent_scope.#rows[row_index][ columnIndex(cv) ] ] ), []);
                        }
                    }
                }
            },
            from(...populationsOfInterest) {

                populationsOfInterest.forEach( from.add, from );
                return this;
            },
            where(...filterFunctions) {

                where.push(...filterFunctions);
                return this;
            },
        };
        
        return selectIterator;        
    }

    /**
     * Returns an interface to quickly create references to loaded/unloaded data
     * 
     * @param {*} uuids 
     * @param {*} removed 
     */
    #createDataReferenceInterface(uuids, removed){

        let cache = undefined;

        return {
                    getRowReferences : _ => cache || (cache = this.getRows(uuids)),
                    get removed_rows() { return removed},
                    *[Symbol.iterator]() {
                        yield cache;
                        yield removed;
                    }
        };
    }

    /**
     * Load data as a population
     * @param {*} data 
     * @param {*} population 
     * @returns {array} row uids
     */
    load(data, population = undefined){

        return this.#createDataReferenceInterface( this.#cells.load(data, population) );
    }

    /**
     * 
     * @param {*} population 
     * @param {*} tags 
     * @returns {array}
     */
    unload(population) {

        return this.#createDataReferenceInterface( [], this.#cells.unload(population) );
    }

    /**
     * This replaces the population at the current populations position within the region(s)
     * 
     * @param {*} data 
     * @param {*} population 
     * @returns {array}
     */
    replace(data, population = undefined) {

        return this.#createDataReferenceInterface( ...this.#cells.replace(data, population) );
    }

    /**
     * Insert data before the start of a population
     * 
     * @param {*} data 
     * @param {*} population 
     * @param {*} new_population_name 
     */
    prepend(data, population, new_population_name = undefined){

        return this.#createDataReferenceInterface( this.#cells.prepend(data, population, new_population_name) );
    }

    /**
     * 
     * @param {*} data 
     * @param {*} population 
     * @param {*} new_population_name 
     */
    append(data, population, new_population_name = undefined){

        return this.#createDataReferenceInterface( this.#cells.append(data, population, new_population_name) );
    }   

    /**
     * Set the reference handle value
     * @param {*} name 
     * @param {*} value 
     */
    _setReferenceHandleValue(name, value){

        this.#reference_handles.set(name, value);
    }

    /**
     * Get the reference handle for a facet references
     * @param {*} name 
     * @param {*} initial_value
     */
    getReferenceHandle(name, initial_value){

        //check is reference

        /**
         * Proxy handler that provides access to a facet reference
         * Forces a table calculation when new value is set
         */
        let ReferenceReferenceHandler = {

            ['valueOf'](){ return Reflect.get(target, 'value'); },
            set: (target, prop, value) => {

                Reflect.set(target, prop, value);

                if( 'value' == prop ){

                    //also set the value of the reference in this table
                    this._setReferenceHandleValue(name, value);

                    this.calculate();
                }

                return true;
            }
        };

        this._setReferenceHandleValue(name, initial_value);
        
        //return reference proxy
        return  new Proxy(
                    {value: initial_value },
                    ReferenceReferenceHandler
                );
    }

    /**
     * Proxy handler that enables array access via index or column name
     * Forces a table calculation when new value is set
     */
    #RowReferenceHandler = {
        get: (target, prop, receiver) => {

            //convert column names
            if( this.#sheet_factory.hasColumn(prop) ){

                prop = ''+this.#sheet_factory.columnIndex(prop);
            }

            return Reflect.get(target, prop, receiver);
        },
        set: (target, prop, value) => {

            Reflect.set(target, prop, value);
            this.calculate();

            return true;
        }
    }

    /**
     * 
     * @param {*} uid 
     * @returns 
     */
    getRow(uid) {

        if( !Number.isInteger(uid) ){
            return undefined;
        };

        return new Proxy(
                    this.#cells.getRow(uid),
                    this.#RowReferenceHandler
                );
    }

    /**
     * 
     * @param {*} uid 
     * @returns 
     */
    getRows(uids) {

        return uids.map( uid => this.getRow(uid) );
    }

    /**
     * 
     * @param {integer} row_index 
     * @param {integer} cell_index 
     * @param {string|number|boolean} value 
     * @param {boolean} re_calculate 
     */
    setRowCellValue(row_index, cell_index, value, re_calculate = true){

        this.#rows[row_index][cell_index] = value;
        re_calculate && this.calculate();
    }

    /**
     * 
     * @param {*} uid 
     * @returns 
     */
    getPopulationRows(...populations){

        return this.getRows( this.#cells.getPopulationRowUids(...populations) );
    }

    /**
     * Returns a reference to the underlying array
     * 
     * @returns readonly array 
     */
    getTableRows(){
        return readonly(this.#rows);
    }

    /**
     * Set the reference facet that this table uses
     * References in this facet will overwrite those in the Sheet default reference facet
     * @param {Function} facet 
     */
    _setReferenceFacet(facet){

        this.#reference_facet = facet;
        this.#reference_facet.reference_count++;
    }

    setReferences(facet){

        this.#sheet_factory.tables(this.#id).setReferences(facet);
    }

    beforeCalculate(...callbackFns) {

        this.#beforeCalculate.push(...callbackFns);
    }

    afterCalculate(...callbackFns) {

        this.#afterCalculate.push(...callbackFns);
    }    

    #aggregate_handler = {
        get: (target, prop) => { 

            //console.log(`${this.id().description}#aggregate_handler.get ${prop}`);                        

            //is prop an aggregate name
            if( this.#hasAggregateBeenCalculated(prop) ){

                return this.#attributes.get(prop);
            }

            if( Reflect.has(target, prop)){
                return Reflect.get(target, prop, receiver);
            }

            Table.#throw_invalid_aggregate_error(prop);            
        },        
        set: (target, prop, fn) => {    

            //console.log(`${this.id().description}#aggregate_handler.set ${prop}`);                        

            this.#current_aggregate_index++;            
            this.#attributes.set(prop, fn() );

            return true;
        }
    };

    #aggregate_proxy = new Proxy({}, this.#aggregate_handler);

    #current_proxy_row_index = 0;
    #row_handler = {
        
        /*
        Set is called first as at this point the fn is not executed. e.g the prop is being set to **this function**
        Once the function is called the get functions for refs/rows/aggregates are called
         */
        get: (target, prop, receiver) => { 

            //always allow constructors and symbolds (column names will never be symbols)
            if( prop === 'constructor' || typeof prop == 'symbol') {

                return Reflect.get(target, prop, receiver);
            }            

            //console.log(`${this.id().description}#row_handler.get ${prop}`);    

            //is prop a column name
            if( this.#isValidColumnDuringFacetCalculation(prop) ){

                return this.#rows[this.#current_proxy_row_index][ this.#sheet_factory.columnIndex(prop)];
            }

            if( Reflect.has(target, prop)){

                return Reflect.get(target, prop, receiver);
            }

            Table.#throw_invalid_column_error(prop);
        },
        set: (target, prop, fn) => {   

            //console.log(`${this.id().description}#row_handler.set ${prop}`);
            
            //set row pointer to initial row and then iterate all rows
            for( this.#current_proxy_row_index = 0; this.#current_proxy_row_index < this.#rows.length; this.#current_proxy_row_index++ ){

                this.#rows[this.#current_proxy_row_index][this.#current_column_index] = fn();                
            }

            this.#current_column_index++;

            //after all the rows have been processed we need point the row in an invalid state to prevent misuse of the handler
            this.#current_proxy_row_index = -1;

            return true;
        }
    };

    #row_proxy = new Proxy({}, this.#row_handler);

    #reference_handler = {
        get: (target, prop, receiver) => { 
/*
            console.log({
                id: this.#id,
                prop,
                facet: this.#reference_facet,
                cached: this.#sheet_factory.resolveReferences( this.#reference_facet ),
                value: this.#sheet_factory.resolveReferences( this.#reference_facet )?.get(prop)
            });
*/
            //first check for a local reference handle
            if( this.#reference_handles.has(prop) ){

                return this.#reference_handles.get(prop);
            }

            return this.#sheet_factory.resolveReferences( this.#reference_facet )?.get(prop) ?? Table.#throw_invalid_reference_error(prop);            
        }
    };

    #reference_proxy = Object.preventExtensions( new Proxy({}, this.#reference_handler) );

    #calculation_handler = {
        get: (target, prop, receiver) => { 
            
            if( typeof prop !== 'function' ){

                return Reflect.get(target, prop, receiver);
            }

            return 0;
        }
    };

    #calculation_proxy = Object.preventExtensions(
                                new Proxy(
                                    {
                                        column  : (column) => this.column(column),
                                        columns : (...columns_of_interest) => this.columns(...columns_of_interest),
                                        facetInterfaces : () => [this.column.bind(this), this.columns.bind(this)],                                        
                                    }, 
                                    this.#calculation_handler)
                                );

    /**
     * Execute all the facets associated with this table
     */                                
    executeFacets(){

        this.#beforeCalculate.forEach( f => f(this.#sheet_factory.getTableByInternalId(this.#id)) );

        //Here we need to execute the TableFactory facets in the order they were added.
        //The facet function needs to have a bound _this_ so that the __this__ functions work.
        //The requirement for a bound _this_ means the facet function cannot be an arrow function.        

        this.#current_aggregate_index = -1;
        this.#current_column_index = this.#sheet_factory.dataColumnNames.length;

        this.#calculating = true;

        try{

            this.#sheet_factory.facets.forEach( f => {

                f.bind(this.#calculation_proxy, this.#aggregate_proxy, this.#row_proxy, this.#reference_proxy)();

                //TODO: once execution has finished we need to set the various proxies to invalid.
            });
        }
        finally {

            this.#calculating = false;
            this.#current_aggregate_index = undefined;
            this.#current_column_index = undefined;
        }

        this.#ticks++;

        this.#afterCalculate.forEach( f => f(this.#sheet_factory.getTableByInternalId(this.#id)) );        
    }

    /**
     * Calculate the entire sheet
     */
    calculate(){

        this.#sheet_factory.updateReferences();

        this.executeFacets();

        //consolidate all sheets belonging to this factory
        this.#sheet_factory.doConsolidation();
    };

    //pass through to sheet factory
    dataColumnNames()           { return this.#sheet_factory.dataColumnNames; }
    calculatedColumnNames()     { return this.#sheet_factory.calculatedColumnNames; }
    columnNames()               { return this.#sheet_factory.columnNames; }
    hasColumn(column_name)      { return this.#sheet_factory.hasColumn(column_name); }
    columnIndex(column_name)    { return this.#sheet_factory.columnIndex(column_name); }
    hasAggregate(aggregate)     { return this.#sheet_factory.hasAggregate(aggregate); }
    aggregateIndex(aggregate)   { return this.#sheet_factory.aggregateIndex(aggregate); }
}


/**
 * 
 */
class TableRows {

    static #default = 'default';

    #dataset;
    #populations;    
    #references = []; //sparse array
    
    #last_population;

    constructor(arr = [], map = new Map()){

        //add unique id
        arr.forEach( (v, i) => Object.defineProperty(v, rowUIDprop, {value : i}) );

        this.#dataset = arr;
        this.#populations = map;
        this.#references.push( ...this.#dataset );
    }

    #RowReferenceHandler = {
          set: (target, prop, value) => {

              let uid = Reflect.get(target, rowUIDprop);

              if( !(uid in this.#references) ) throw new Error(`Row::set uid(${uid}) no longer exists`);

              this.#references[uid][prop] = value;

              return true;
          },
          get: (target, prop, receiver) => {

              if( isFunction(target[prop]) || isStdObjectPropOrSymbol(prop) ){

                  return Reflect.get(target, prop, receiver);
              }

              let uid = Reflect.get(target, rowUIDprop);

              if( !(uid in this.#references) ) throw new Error(`Row::get uid(${uid}) no longer exists`);

              return this.#references[uid][prop];
          }
    };

    /**
     * Get a row reference
     * @param {*} uid 
     * @returns {Object} row proxy object
     */
    getRow(uid) {

        return new Proxy(
                    {
                        [Symbol.iterator] : this.#references[uid][Symbol.iterator],
                        [rowUIDprop]: uid,
                        exists    : _ => uid in this.#references,
                    }, 
                    this.#RowReferenceHandler   
                );
    }

    /**
     * 
     * @param {string} populations
     * @returns 
     */
    getPopulationRowUids(...populations){

        return this.forEachRowIndexInPopulations(...populations).map( index => this.#dataset[rowUIDprop]);
    }

    /**
     * 
     * @param {*} data 
     * @param {*} population 
     * @returns array of unique row ids
     */
    load(data, population = TableRows.#default){

        //if we are not continuing a population - check if it has already been defined
        if( this.#last_population != population && this.#populations.get(population) ){

            throw new RangeError('Non-contiguous population loaded');
        }

        let size  = data.length,
            start = this.#dataset.length;
            
        if( !size ){
            return;
        }

        let uids = [];

        data.forEach( (v, i) => {
                            Object.defineProperty(v, rowUIDprop, {value : i + this.#references.length});
                            uids.push(v[rowUIDprop]);
                    });  

        this.#dataset.push(...data);
        this.#references.push( ...data );

        //adjust the population details
        if( this.#last_population == population ){

            [start, size] = this.#populations.get(population);
            size += data.length;
        }

        //record the size of the population
        this.#populations.set(population, [start, size]);

        this.#last_population = population;

        return uids;
    }

    unload(population = TableRows.#default) {

        if( !this.#populations.get(population) ){

            return [];
        }

        let [start, deleteCount] = this.#populations.get(population);

        //remove the population from the population list
        this.#populations.delete(population);

        //recalc the positions of the subsequent populations        
        for(const [pop, [start_of, size]] of this.#populations){

            if( start_of > start){
                this.#populations.set(pop, [start_of - deleteCount, size]);
            }
        }

        //update the last population name
        this.#last_population = Array.from(this.#populations.keys()).pop();

        //remove the population from the dataset which returns the removed population rows
        let removed = this.#dataset.splice(start, deleteCount);            

        //remove from the this.#references array
        removed.forEach( v => delete this.#references[v[rowUIDprop]]);

        return removed;
    }

    /**
     * This replaces the population at the current populations position within the region
     * 
     * @param {*} data 
     * @param {*} population 
     * @returns 
     */
    replace(data, population = TableRows.#default) {

        let [start, deleteCount] = this.#populations.get(population);

        let diff = data.length - deleteCount;

        //set the size of the new population
        this.#populations.set(population, [start, data.length]);

        //recalc the positions of the subsequent populations        
        for(const [pop, [start_of, size]] of this.#populations){

            if( start_of > start){
                this.#populations.set(pop, [start_of + diff, size]);
            }
        }

        //set uids
        let uids = [];

        data.forEach( (v, i) => {
                            Object.defineProperty(v, rowUIDprop, {value : i + this.#references.length});
                            uids.push(v[rowUIDprop]);
                        });  

        this.#references.push( ...data );

        //remove the population from the dataset and return the removed population rows
        let removed = this.#dataset.splice(start, deleteCount, ...data);            

        //remove from the this.#references array (do not alter indexes)
        removed.forEach( v => delete this.#references[v[rowUIDprop]]);

        return [uids, removed];        
    }

    /**
     * Insert data before/after a population
     * 
     * @param {*} data 
     * @param {*} population 
     * @param {*} new_population_name 
     */
    #insertRows(before, data, population = TableRows.#default, new_population_name = undefined){

        let [start, length] = this.#populations.get(population),
            expanding_population = undefined == new_population_name || population == new_population_name;

        //insert the new rows after this population
        let start_of_splice = before ? start : start + length;
            
        //set uids
        let uids = [];

        data.forEach( (v, i) => {
                            Object.defineProperty(v, rowUIDprop, {value : i + this.#references.length});
                            uids.push(v[rowUIDprop]);
                        });  

        this.#dataset.splice(start_of_splice, 0, ...data);

        //if we are expanding the existing population
        if( expanding_population ){
            
            length += data.length;

            this.#populations.set(population, [start, length]);
        }
        else {

            //adjust the position of the prepended population
            if( before) {

                start += data.length;                
                this.#populations.set(population, [start, length]);
            }
        }

        //recalc the positions of the subsequent populations        
        for(const [pop, [start_of, size]] of this.#populations){

            if( start_of > start && pop !== new_population_name ){
                this.#populations.set(pop, [start_of + data.length, size]);
            }
        }        

        //add the new population
        if( !expanding_population ){
            
            this.#populations.set(new_population_name, [start_of_splice, data.length]);
        }

        return uids;
    }

    /**
     * Insert data before the start of a population
     * 
     * @param {*} data 
     * @param {*} population 
     * @param {*} new_population_name 
     */
    prepend(data, population = TableRows.#default, new_population_name = undefined){

        return this.#insertRows(true, data, population, new_population_name);
    }

    /**
     * 
     * @param {*} data 
     * @param {*} population 
     * @param {*} new_population_name 
     */
    append(data, population, new_population_name = undefined){

        return this.#insertRows(false, data, population, new_population_name);        
    }   

    /**
     * 
     * @param  {array[string]}  populationsOfInterest  An array of columns to return in the order supplied
     * @returns iterator
     */
    forEachRowIndexInPopulations(...populationsOfInterest) {

        if( !populationsOfInterest?.length ){

            let ds = this.#dataset;

            //return an iterator that iterates over all the array indexes
            return {
                *[Symbol.iterator]() {

                    for(let nextIndex = 0; nextIndex < ds.length; nextIndex++){
                        yield nextIndex;
                    }
                }
            }
        }

        let parent_scope = this;

        //return an iterator that only iterates over the indexes in the listed populations ...
        return {
            *[Symbol.iterator]() {

                for(const [pop, [start_of, size]] of parent_scope.#populations ){

                    //if this is a population of interest ...
                    if( populationsOfInterest.indexOf( pop ) >= 0 ){

                        //iterate the indexes
                        for(let nextIndex = start_of; nextIndex < start_of + size; nextIndex++){
                            yield nextIndex;
                        }
                    }
                }
            }
        }
    }
}