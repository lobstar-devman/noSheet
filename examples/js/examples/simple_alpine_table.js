document.addEventListener('alpine:init', () => {

    Alpine.data('simpleNoSheetTable', (alpineStoreId) => ({

        init() {

            //if multiple tables are used - record which ones have been init'd
            let initdTablesList = [];

            //watch the store for table initialization
            this.$watch(`$store.${alpineStoreId}`,(new_nosheet, old_nosheet)=>{

                console.log(`Alpine::watch -> Alpine.store('${alpineStoreId}') has changed`);

                this.reset();

                if( !initdTablesList.includes(new_nosheet.id()) ){

                    initdTablesList.push(new_nosheet.id());

                    //Register an afterCalculate callback on the 'nosheet'
                    Alpine.store(alpineStoreId).afterCalculate( _ => {
                        
                        this.calculationTick++;
                    });
                }

                //if we are switching from an already initialised table
                if( old_nosheet?.id /*check for id function*/){

                    //force update of aggregates
                    this.calculationTick++;
                }
            });                   

            //Register an aggregate handler component
            Alpine.data('aggregate', (name, formatter) => ({

                init() {

                    this.$watch('calculationTick', _ => this.calculatedValue = Alpine.store(alpineStoreId)[name].valueOf());
                },

                calculatedValue: undefined,

                get value() {

                    let v = this.calculatedValue ?? Alpine.store(alpineStoreId)[name]?.valueOf();

                    return !formatter ? v : formatter.format(v);
                },

            }));
        },

        calculationTick: 0,

        get storeId() { return alpineStoreId; },

        get storedTable(){

            return Alpine.store(this.storeId);
        },

        setCellValue(row, column, value){

            this.storedTable.setRowCellValue( row, column, value );
        },

        //The table rows
        items: [],

        reset(){

            this.items = this.storedTable.getTableRows();
            this.storedTable.calculate();
        },

        get rowCount() { return this.items?.length??0; },

        get isEmpty() {
            return this.rowCount ? false : true;
        },
 }))
});