<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateEventsTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {   
        Schema::create('events', function (Blueprint $table) {
            $table->bigIncrements('id'); // Primary Key

            $table->string('title')->unique(); // Unique and not nullable

            $table->string('organization')->nullable();
            $table->text('description')->nullable();

            $table->date('date_start')->nullable();
            $table->date('date_end')->nullable();

            $table->time('time_start')->nullable();
            $table->time('time_end')->nullable();

            // Foreign Key to 'venues' table, nullable
            $table->unsignedBigInteger('venue_id')->nullable();
            $table->foreign('venue_id')->references('id')->on('venues')->onDelete('set null');

            $table->string('address')->nullable();
            $table->string('external_id')->nullable();

            $table->timestamps(); // created_at and updated_at (nullable by default)
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('events');
    }
}
