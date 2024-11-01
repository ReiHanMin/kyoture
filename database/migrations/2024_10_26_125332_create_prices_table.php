<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreatePricesTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('prices', function (Blueprint $table) {
            $table->id(); // Primary key
            $table->foreignId('event_id')->constrained()->onDelete('cascade'); // Foreign key to events
            $table->string('price_tier')->nullable(); // Price tier (e.g., "VIP", "General")
            $table->decimal('amount', 10, 2); // Amount for the price
            $table->string('currency', 3)->default('JPY'); // Currency, default to JPY
            $table->string('discount_info')->nullable(); // Info about discounts, if any
            $table->timestamps(); // Adds created_at and updated_at columns
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('prices');
    }
}
